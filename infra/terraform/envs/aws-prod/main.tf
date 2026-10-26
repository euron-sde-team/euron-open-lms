# ─────────────────────────────────────────────────────────────────────────────
# aws-prod: production. Three AZs with a NAT per AZ, Multi-AZ database, two Redis
# nodes with automatic failover, at least two tasks per service, deletion protection,
# CloudFront + WAF in front, a year of logs.
#
# Everything is in ../../modules/deployment; this file only picks the sizes.
#   make aws-deploy ENV=aws-prod
# ─────────────────────────────────────────────────────────────────────────────
module "lms" {
  source    = "../../modules/deployment"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name_prefix     = var.name_prefix
  domain          = var.domain
  route53_zone_id = var.route53_zone_id
  certificate_arn = var.certificate_arn
  mail_domain     = var.mail_domain
  product_name    = var.product_name
  image_tag       = var.image_tag

  openai_api_key       = var.openai_api_key
  create_openai_secret = var.create_openai_secret
  ai_provider          = var.ai_provider
  openai_model         = var.openai_model

  log_level                  = var.log_level
  require_email_verification = var.require_email_verification
  # Anything else the API reads as a secret (GEMINI_API_KEY for ai_provider = "gemini").
  api_extra_secrets = var.api_extra_secrets

  enable_stripe           = var.enable_stripe
  stripe_publishable_key  = var.stripe_publishable_key
  stripe_secret_key       = var.stripe_secret_key
  stripe_webhook_secret   = var.stripe_webhook_secret
  enable_razorpay         = var.enable_razorpay
  razorpay_key_id         = var.razorpay_key_id
  razorpay_key_secret     = var.razorpay_key_secret
  razorpay_webhook_secret = var.razorpay_webhook_secret

  evs_base_url       = var.evs_base_url
  evs_playback_key   = var.evs_playback_key
  evs_read_key       = var.evs_read_key
  evs_webhook_secret = var.evs_webhook_secret
  video_origins      = var.video_origins

  push_provider            = var.push_provider
  fcm_service_account_json = var.fcm_service_account_json

  az_count                   = 3
  single_nat_gateway         = false
  enable_interface_endpoints = true

  enable_cdn = var.enable_cdn
  enable_waf = true

  db_instance_class        = var.db_instance_class
  db_multi_az              = true
  db_backup_retention_days = 14
  deletion_protection      = true

  cache_node_type               = var.cache_node_type
  cache_node_count              = 2
  cache_snapshot_retention_days = 7

  kms_deletion_window_days    = 30
  secret_recovery_window_days = 30

  cpu_architecture = var.cpu_architecture

  app_db_secret_arn = var.app_db_secret_arn
  app_db_username   = var.app_db_username

  api_min_count    = 2
  api_max_count    = 10
  worker_min_count = 2
  worker_max_count = 6
  web_min_count    = 2
  web_max_count    = 6

  media_cors_extra_origins = var.media_cors_extra_origins

  log_retention_days      = 365
  flow_log_retention_days = 365
  alarm_email             = var.alarm_email
  api_extra_environment   = var.api_extra_environment
}
