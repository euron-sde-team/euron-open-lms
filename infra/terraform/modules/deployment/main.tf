# ─────────────────────────────────────────────────────────────────────────────
# One complete deployment: network, data, cache, keys, mail, and the three services,
# all behind one host name (var.domain, e.g. app.example.com):
#
#   https://<domain>/api/*, /up   api     (HTTP JSON API, payment and video webhooks)
#   https://<domain>/*            web     (Next.js: catalog, classroom, /admin)
#   (no inbound traffic)          worker  (BullMQ jobs, same image as api)
#
# Webhooks arrive on the api rule like any other request:
#   /api/webhooks/stripe, /api/webhooks/razorpay, /api/webhooks/evs
# (the webhook_urls output lists them for the provider dashboards). Lecture video is
# never uploaded here: it plays from euron-video-system (EVS_BASE_URL).
#
# One origin keeps the refresh cookie first-party and needs no CORS for the app itself.
# Plus two one-off task definitions on the api image: migrate and admin (bootstrap
# the first administrator: it emails a set-password link, so it gets the mail setup).
#
# With the CDN on, CloudFront adds a secret header (X-Origin-Verify) to every origin
# request and the api and web listener rules require it; the load balancer answers
# anything else with 403. The value is generated here and lives only in Terraform state
# (and in the CloudFront and listener configuration); it is never an output.
#
# envs/aws-dev and envs/aws-prod call this module with different sizes and safety
# switches; everything else is identical by construction.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_region" "current" {}

locals {
  region      = data.aws_region.current.region
  hostnames   = { app = var.domain }
  app_url     = "https://${var.domain}"
  images      = { for k, url in module.ecr.repository_urls : k => "${url}:${var.image_tag}" }
  mail_domain = coalesce(var.mail_domain, var.domain)
  # The API sees one proxy hop (the ALB), or two with CloudFront in front.
  trust_proxy = var.enable_cdn ? "2" : "1"
  # Decided on a boolean so the plan never depends on the (sensitive) key itself.
  has_openai_key = nonsensitive(var.openai_api_key != null)
  # Quiz drafting, grading suggestions and polish: OpenAI when a key is configured,
  # otherwise off (the web app then hides the AI features; everything works by hand).
  # Gemini: set ai_provider = "gemini" and pass GEMINI_API_KEY through api_extra_secrets.
  ai_provider = coalesce(var.ai_provider, local.has_openai_key || var.create_openai_secret ? "openai" : "none")
  api_port    = 5026
  web_port    = 3000

  # euron-video-system: the secret exists whenever a base URL is configured (a plain
  # variable, so this is known at plan time).
  with_evs = var.evs_base_url != null
  # The CSP's media-src and connect-src for lecture video: what the operator lists, or
  # else the EVS origin (scheme and host of evs_base_url).
  video_origins = length(var.video_origins) > 0 ? var.video_origins : (local.with_evs ? [regex("^https?://[^/]+", var.evs_base_url)] : [])

  webhook_urls = {
    stripe   = "${local.app_url}/api/webhooks/stripe"
    razorpay = "${local.app_url}/api/webhooks/razorpay"
    evs      = "${local.app_url}/api/webhooks/evs"
  }
}

# ─── Foundation ──────────────────────────────────────────────────────────────

module "network" {
  source                     = "../network"
  name_prefix                = var.name_prefix
  cidr_block                 = var.vpc_cidr
  az_count                   = var.az_count
  single_nat_gateway         = var.single_nat_gateway
  enable_interface_endpoints = var.enable_interface_endpoints
  flow_log_retention_days    = var.flow_log_retention_days
  logs_kms_key_arn           = module.kms.key_arn
}

module "kms" {
  source                  = "../kms"
  name_prefix             = var.name_prefix
  deletion_window_in_days = var.kms_deletion_window_days
  admin_principal_arns    = var.kms_admin_principal_arns
}

module "secrets" {
  source                  = "../secrets"
  name_prefix             = var.name_prefix
  kms_key_arn             = module.kms.key_arn
  recovery_window_in_days = var.secret_recovery_window_days
  create_openai_secret    = local.has_openai_key || var.create_openai_secret
  openai_api_key          = var.openai_api_key

  enable_stripe           = var.enable_stripe
  enable_razorpay         = var.enable_razorpay
  stripe_secret_key       = var.stripe_secret_key
  stripe_webhook_secret   = var.stripe_webhook_secret
  razorpay_key_secret     = var.razorpay_key_secret
  razorpay_webhook_secret = var.razorpay_webhook_secret

  create_evs_secret  = local.with_evs
  evs_playback_key   = var.evs_playback_key
  evs_read_key       = var.evs_read_key
  evs_webhook_secret = var.evs_webhook_secret

  create_push_secret       = var.push_provider == "fcm"
  fcm_service_account_json = var.fcm_service_account_json
}

module "database" {
  source                = "../database"
  name_prefix           = var.name_prefix
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  kms_key_arn           = module.kms.key_arn
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.deletion_protection
  skip_final_snapshot   = !var.deletion_protection
  monitoring_interval   = var.db_monitoring_interval
}

module "cache" {
  source                      = "../cache"
  name_prefix                 = var.name_prefix
  vpc_id                      = module.network.vpc_id
  subnet_ids                  = module.network.private_subnet_ids
  kms_key_arn                 = module.kms.key_arn
  node_type                   = var.cache_node_type
  node_count                  = var.cache_node_count
  snapshot_retention_days     = var.cache_snapshot_retention_days
  log_retention_days          = var.log_retention_days
  secret_recovery_window_days = var.secret_recovery_window_days
  alarm_topic_arn             = module.observability.alarm_topic_arn
}

module "storage" {
  source               = "../storage"
  name_prefix          = var.name_prefix
  kms_key_arn          = module.kms.key_arn
  cors_allowed_origins = concat([local.app_url], var.media_cors_extra_origins)
  enable_versioning    = true
  force_destroy        = !var.deletion_protection
}

module "email" {
  source          = "../email"
  name_prefix     = var.name_prefix
  domain          = local.mail_domain
  manage_dns      = var.route53_zone_id != null
  route53_zone_id = var.route53_zone_id
  dmarc_policy    = var.dmarc_policy
}

module "ecr" {
  source       = "../ecr"
  name_prefix  = var.name_prefix
  kms_key_arn  = module.kms.key_arn
  force_delete = !var.deletion_protection
}

# ─── Edge ────────────────────────────────────────────────────────────────────

module "edge" {
  source                = "../edge"
  name_prefix           = var.name_prefix
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  hostnames             = local.hostnames
  route53_zone_id       = var.route53_zone_id
  certificate_arn       = var.certificate_arn
  create_dns_records    = !var.enable_cdn
  allow_only_cloudfront = var.enable_cdn
  access_logs_bucket    = var.alb_access_logs_bucket
  deletion_protection   = var.deletion_protection
  idle_timeout          = var.alb_idle_timeout
}

# The secret CloudFront sends to the load balancer. Rotate with
#   terraform apply -replace='module.lms.random_password.origin_verify[0]'
# (CloudFront and the rules update in the same apply; requests in flight during the
# CloudFront propagation can see a short burst of 403s).
resource "random_password" "origin_verify" {
  count   = var.enable_cdn ? 1 : 0
  length  = 48
  special = false
}

locals {
  origin_header_name  = "X-Origin-Verify"
  origin_header_value = var.enable_cdn ? random_password.origin_verify[0].result : null
}

module "cdn" {
  count               = var.enable_cdn ? 1 : 0
  source              = "../cdn"
  providers           = { aws.us_east_1 = aws.us_east_1 }
  name_prefix         = var.name_prefix
  hostnames           = local.hostnames
  route53_zone_id     = var.route53_zone_id
  origin_domain_name  = module.edge.dns_name
  origin_header_name  = local.origin_header_name
  origin_header_value = local.origin_header_value
  enable_waf          = var.enable_waf
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# ─── API image: environment, secrets, permissions ───────────────────────────

locals {
  # Mail settings: the api and worker send mail, and so does the admin task (the
  # set-password link for the first administrator).
  mail_environment = {
    PRODUCT_NAME          = var.product_name
    APP_WEB_URL           = local.app_url
    MAIL_MODE             = "ses"
    MAIL_FROM             = "${var.product_name} <${module.email.from_address}>"
    SES_REGION            = local.region
    SES_CONFIGURATION_SET = module.email.configuration_set
  }

  # Everything except secrets. Names are the ones apps/api/src/core/config.ts declares.
  api_environment = merge(local.mail_environment, {
    NODE_ENV                   = "production"
    TZ                         = "UTC"
    PORT                       = tostring(local.api_port)
    LOG_LEVEL                  = var.log_level
    PUBLIC_API_URL             = local.app_url
    CORS_ORIGINS               = local.app_url
    TRUST_PROXY                = local.trust_proxy
    COOKIE_SECURE              = "true"
    REQUIRE_EMAIL_VERIFICATION = tostring(var.require_email_verification)
    JOBS_MODE                  = "queue"
    AWS_REGION                 = local.region
    STORAGE                    = "s3"
    S3_BUCKET                  = module.storage.bucket_name
    S3_REGION                  = local.region
    DATA_DIR                   = "/tmp/data"
    AI_PROVIDER                = local.ai_provider
    OPENAI_MODEL               = var.openai_model
    PUSH_PROVIDER              = var.push_provider
    MIGRATE_ON_BOOT            = tostring(var.migrate_on_boot)
    MIGRATIONS_DIR             = "/app/db/migrations"
    DB_POOL_MAX                = tostring(var.db_pool_max)
    # No database password in the environment: the API reads it from the secret for
    # each new connection, so a rotation needs no redeploy. The RDS-managed master
    # secret, or the application role's secret once app_db_secret_arn is set (see
    # docs/guides/operations.md, "Least-privilege database role").
    DATABASE_SECRET_ARN = local.app_db_secret_arn
    DB_HOST             = module.database.address
    DB_PORT             = tostring(module.database.port)
    DB_NAME             = module.database.database_name
    DB_USER             = local.app_db_username
    DB_SSL              = "require"
    }, {
    # Non-secret gateway and video settings, only when set (an unset variable means the
    # API's own default or "off"). The secret halves come from <prefix>/payments and
    # <prefix>/evs below.
    for k, v in {
      STRIPE_PUBLISHABLE_KEY = var.stripe_publishable_key
      RAZORPAY_KEY_ID        = var.razorpay_key_id
      EVS_BASE_URL           = var.evs_base_url
    } : k => v if v != null
  }, var.api_extra_environment)

  # JWT_SECRET, REFRESH_SECRET, TOTP_ENCRYPTION_KEY, REDIS_URL and, when enabled,
  # OPENAI_API_KEY, the payment gateway secrets, the EVS keys and the FCM service account.
  api_secrets = concat(module.secrets.secret_refs, module.cache.secret_refs, var.api_extra_secrets)

  # One-off tasks need the database; migrate nothing else (no signing keys, no cache,
  # no mail). admin adds the mail settings and the TOTP key.
  task_environment = {
    NODE_ENV            = "production"
    TZ                  = "UTC"
    LOG_LEVEL           = var.log_level
    PRODUCT_NAME        = var.product_name
    APP_WEB_URL         = local.app_url
    MIGRATIONS_DIR      = "/app/db/migrations"
    DATABASE_SECRET_ARN = module.database.master_user_secret_arn
    DB_HOST             = module.database.address
    DB_PORT             = tostring(module.database.port)
    DB_NAME             = module.database.database_name
    DB_USER             = module.database.master_username
    DB_SSL              = "require"
  }

  admin_environment = merge(local.task_environment, local.mail_environment)
  admin_secrets     = [module.secrets.totp_secret_ref]

  # api and worker connect as the application role when one is configured; migrate
  # and admin always use the master user (migrations need DDL).
  app_db_secret_arn = coalesce(var.app_db_secret_arn, module.database.master_user_secret_arn)
  app_db_username   = coalesce(var.app_db_username, module.database.master_username)

  container_health = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.api_port}/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
}

# The runtime database password: read by the task role on every new connection.
# database: the master secret (migrate, admin). app_database: whatever api and worker
# connect with (the master secret, or the application role's secret).
data "aws_iam_policy_document" "app_database" {
  statement {
    sid       = "DatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.app_db_secret_arn]
  }
  statement {
    sid       = "DatabasePasswordDecrypt"
    actions   = ["kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "database" {
  statement {
    sid       = "DatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.database.master_user_secret_arn]
  }
  statement {
    sid       = "DatabasePasswordDecrypt"
    actions   = ["kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

# Sending mail through the deployment's SES identity and configuration set only.
data "aws_iam_policy_document" "mail" {
  statement {
    sid       = "SendMail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [module.email.identity_arn, module.email.configuration_set_arn]
  }
}

# admin task: the database, plus mail for the set-password link.
data "aws_iam_policy_document" "admin" {
  source_policy_documents = [data.aws_iam_policy_document.database.json, data.aws_iam_policy_document.mail.json]
}

# api and worker: media objects, the key that encrypts them, mail, and the database.
# Nothing else; the injected secrets are read by the execution role, not this one.
data "aws_iam_policy_document" "api" {
  source_policy_documents = [data.aws_iam_policy_document.app_database.json, data.aws_iam_policy_document.mail.json]

  statement {
    # GetObject also authorizes HEAD (upload confirmation reads the object's size and type).
    sid       = "Media"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.storage.bucket_arn}/*"]
  }
  statement {
    sid       = "MediaKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
}

# ─── Services ────────────────────────────────────────────────────────────────

module "api" {
  source                   = "../service"
  name_prefix              = var.name_prefix
  name                     = "api"
  image                    = local.images.api
  command                  = ["node", "--enable-source-maps", "dist/index.js"]
  container_port           = local.api_port
  environment              = local.api_environment
  secrets                  = local.api_secrets
  cluster_arn              = aws_ecs_cluster.this.arn
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  listener_arn             = module.edge.https_listener_arn
  lb_security_group_id     = module.edge.security_group_id
  listener_priority        = 100
  host_headers             = [var.domain]
  path_patterns            = ["/api/*", "/up"]
  require_origin_header    = var.enable_cdn
  origin_header_name       = local.origin_header_name
  origin_header_value      = local.origin_header_value
  deregistration_delay     = 60
  health_check_path        = "/api/ready"
  container_health_command = local.container_health
  connect_to_database      = true
  db_security_group_id     = module.database.security_group_id
  db_port                  = module.database.port
  connect_to_cache         = true
  cache_security_group_id  = module.cache.security_group_id
  cache_port               = module.cache.port
  kms_key_arn              = module.kms.key_arn
  has_task_policy          = true
  task_policy_json         = data.aws_iam_policy_document.api.json
  cpu                      = var.api_cpu
  cpu_architecture         = var.cpu_architecture
  memory                   = var.api_memory
  min_count                = var.api_min_count
  max_count                = var.api_max_count
  log_retention_days       = var.log_retention_days
  logs_kms_key_arn         = module.kms.key_arn
}

module "worker" {
  source                  = "../service"
  name_prefix             = var.name_prefix
  name                    = "worker"
  image                   = local.images.api
  command                 = ["node", "--enable-source-maps", "dist/worker.js"]
  environment             = local.api_environment
  secrets                 = local.api_secrets
  attach_to_load_balancer = false
  cluster_arn             = aws_ecs_cluster.this.arn
  vpc_id                  = module.network.vpc_id
  subnet_ids              = module.network.private_subnet_ids
  connect_to_database     = true
  db_security_group_id    = module.database.security_group_id
  db_port                 = module.database.port
  connect_to_cache        = true
  cache_security_group_id = module.cache.security_group_id
  cache_port              = module.cache.port
  kms_key_arn             = module.kms.key_arn
  has_task_policy         = true
  task_policy_json        = data.aws_iam_policy_document.api.json
  cpu                     = var.worker_cpu
  cpu_architecture        = var.cpu_architecture
  memory                  = var.worker_memory
  min_count               = var.worker_min_count
  max_count               = var.worker_max_count
  log_retention_days      = var.log_retention_days
  logs_kms_key_arn        = module.kms.key_arn
}

module "web" {
  source         = "../service"
  name_prefix    = var.name_prefix
  name           = "web"
  image          = local.images.web
  container_port = local.web_port
  environment = merge({
    NODE_ENV     = "production"
    TZ           = "UTC"
    PORT         = tostring(local.web_port)
    HOSTNAME     = "0.0.0.0"
    PRODUCT_NAME = var.product_name
    # Server-side requests from Next go back through the load balancer to the API.
    API_INTERNAL_URL = local.app_url
    # Presigned media URLs (thumbnails, attachments, certificates) are virtual-hosted
    # S3 URLs; the CSP must allow that origin.
    MEDIA_ORIGINS = "https://${module.storage.bucket_name}.s3.${local.region}.amazonaws.com https://${module.storage.bucket_name}.s3.amazonaws.com"
    },
    # Where lecture video streams from (EVS), space-separated, for the CSP.
    length(local.video_origins) > 0 ? { VIDEO_ORIGINS = join(" ", local.video_origins) } : {},
  )
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  listener_arn         = module.edge.https_listener_arn
  lb_security_group_id = module.edge.security_group_id
  # After the api rule: everything on the host the api rule did not take.
  listener_priority     = 200
  host_headers          = [var.domain]
  require_origin_header = var.enable_cdn
  origin_header_name    = local.origin_header_name
  origin_header_value   = local.origin_header_value
  health_check_path     = "/"
  kms_key_arn           = module.kms.key_arn
  cpu                   = var.web_cpu
  cpu_architecture      = var.cpu_architecture
  memory                = var.web_memory
  min_count             = var.web_min_count
  max_count             = var.web_max_count
  log_retention_days    = var.log_retention_days
  logs_kms_key_arn      = module.kms.key_arn
}

# ─── One-off tasks (make aws-migrate, make aws-admin) ───────────────────────

module "migrate" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "migrate"
  image                = local.images.api
  command              = ["node", "dist/migrate.js"]
  environment          = local.task_environment
  create_service       = false
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  connect_to_database  = true
  db_security_group_id = module.database.security_group_id
  db_port              = module.database.port
  kms_key_arn          = module.kms.key_arn
  has_task_policy      = true
  task_policy_json     = data.aws_iam_policy_document.database.json
  cpu                  = 256
  cpu_architecture     = var.cpu_architecture
  memory               = 512
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

# The command is overridden at run time with the email (scripts/aws-run-task.sh).
module "admin" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "admin"
  image                = local.images.api
  command              = ["node", "dist/cli.js", "admin:create"]
  environment          = local.admin_environment
  secrets              = local.admin_secrets
  create_service       = false
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  connect_to_database  = true
  db_security_group_id = module.database.security_group_id
  db_port              = module.database.port
  kms_key_arn          = module.kms.key_arn
  has_task_policy      = true
  task_policy_json     = data.aws_iam_policy_document.admin.json
  cpu                  = 256
  cpu_architecture     = var.cpu_architecture
  memory               = 512
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

# ─── Observability ───────────────────────────────────────────────────────────

module "observability" {
  source                 = "../observability"
  name_prefix            = var.name_prefix
  alarm_email            = var.alarm_email
  alb_arn_suffix         = module.edge.arn_suffix
  ecs_cluster_name       = aws_ecs_cluster.this.name
  db_instance_identifier = module.database.instance_identifier
  worker_log_group_name  = module.worker.log_group_name
  services = {
    api    = { service_name = module.api.service_name, load_balanced = true, target_group_arn_suffix = module.api.target_group_arn_suffix }
    web    = { service_name = module.web.service_name, load_balanced = true, target_group_arn_suffix = module.web.target_group_arn_suffix }
    worker = { service_name = module.worker.service_name, load_balanced = false }
  }
}
