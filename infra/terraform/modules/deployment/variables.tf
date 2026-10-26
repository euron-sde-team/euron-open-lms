# ─── Identity ────────────────────────────────────────────────────────────────

variable "name_prefix" {
  description = "Prefix for every resource name, e.g. \"lms-prod\". Lowercase letters, digits and hyphens."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,23}$", var.name_prefix))
    error_message = "name_prefix must be 3-24 characters: lowercase letters, digits, hyphens, starting with a letter."
  }
}

variable "domain" {
  description = "The app host, e.g. \"app.example.com\". The web app and the API (/api/*, including the payment and video webhooks) are both served on it."
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone serving the domain. Enables fully automatic certificates and DNS. Without it, pass certificate_arn and publish the records from the outputs."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional ACM certificate for the app host. Required when route53_zone_id is null."
  type        = string
  default     = null
  validation {
    condition     = var.route53_zone_id != null || var.certificate_arn != null
    error_message = "Set route53_zone_id (automatic certificates and DNS) or certificate_arn (an existing certificate for the app host)."
  }
}

variable "mail_domain" {
  description = "Sending domain verified in SES (defaults to domain). Mail goes out as no-reply@<mail_domain>."
  type        = string
  default     = null
}

variable "dmarc_policy" {
  description = "DMARC policy to publish for the mail domain (none, quarantine, reject), or null to leave DMARC alone."
  type        = string
  default     = "none"
}

variable "product_name" {
  description = "Product name shown in the app, emails and authenticator apps."
  type        = string
  default     = "Euron Open LMS"
}

variable "image_tag" {
  description = "Tag of the api and web images in ECR (make aws-deploy uses the git commit)."
  type        = string
}

# ─── AI (quiz drafting, grading suggestions, polish) ─────────────────────────

variable "openai_api_key" {
  description = "Optional OpenAI API key for quiz drafting, grading suggestions and polish. Stored in Secrets Manager (and therefore in Terraform state). Alternative: create_openai_secret = true and put the key in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "create_openai_secret" {
  description = "Create the OPENAI_API_KEY secret with a placeholder value to replace by hand (aws secretsmanager put-secret-value), keeping the key out of Terraform state."
  type        = bool
  default     = false
}

variable "ai_provider" {
  description = "AI_PROVIDER: openai, gemini or none. Null: openai when a key (or the secret) is configured, otherwise none."
  type        = string
  default     = null
  validation {
    condition     = var.ai_provider == null || contains(["openai", "gemini", "none"], coalesce(var.ai_provider, "none"))
    error_message = "ai_provider must be openai, gemini, none or null."
  }
}

variable "openai_model" {
  description = "OPENAI_MODEL used for quiz drafting, grading suggestions and polish."
  type        = string
  default     = "gpt-4o-mini"
}

# ─── Payments (Stripe, Razorpay) ─────────────────────────────────────────────
# Each gateway's secret half lives in <prefix>/payments. Leave the sensitive values
# null to keep them out of Terraform state: the secret is created with "set-me"
# placeholders and the API will not sell through a gateway until an operator replaces
# them (aws secretsmanager put-secret-value, the full JSON object). Point the gateway's
# webhook at the matching webhook_urls output.

variable "enable_stripe" {
  description = "Sell through Stripe: creates <prefix>/payments and injects STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET into the api and worker."
  type        = bool
  default     = false
}

variable "stripe_publishable_key" {
  description = "STRIPE_PUBLISHABLE_KEY (pk_live_... or pk_test_...). Not a secret: a plain environment variable."
  type        = string
  default     = null
}

variable "stripe_secret_key" {
  description = "Optional STRIPE_SECRET_KEY. Stored in Secrets Manager (and therefore in Terraform state). Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Optional STRIPE_WEBHOOK_SECRET, the signing secret of the endpoint registered at webhook_urls.stripe. Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "enable_razorpay" {
  description = "Sell through Razorpay: creates <prefix>/payments and injects RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET into the api and worker. Needs razorpay_key_id."
  type        = bool
  default     = false
}

variable "razorpay_key_id" {
  description = "RAZORPAY_KEY_ID (rzp_live_... or rzp_test_...). Not a secret: a plain environment variable. Required with enable_razorpay."
  type        = string
  default     = null
  validation {
    condition     = !var.enable_razorpay || var.razorpay_key_id != null
    error_message = "enable_razorpay needs razorpay_key_id (the API treats Razorpay as off without it)."
  }
}

variable "razorpay_key_secret" {
  description = "Optional RAZORPAY_KEY_SECRET. Stored in Secrets Manager (and in state). Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "razorpay_webhook_secret" {
  description = "Optional RAZORPAY_WEBHOOK_SECRET, the secret chosen for the webhook at webhook_urls.razorpay. Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

# ─── Video (euron-video-system) ──────────────────────────────────────────────
# Lecture video is never uploaded to the LMS: it plays from an euron-video-system
# (EVS) deployment. Setting evs_base_url creates <prefix>/evs with the keys below.

variable "evs_base_url" {
  description = "EVS_BASE_URL, e.g. \"https://video.example.com\". Null: EVS lectures cannot play (other video providers still do)."
  type        = string
  default     = null
  validation {
    condition     = var.evs_base_url == null || can(regex("^https://[^/]+", coalesce(var.evs_base_url, "https://x")))
    error_message = "evs_base_url must be an https:// URL."
  }
}

variable "evs_playback_key" {
  description = "Optional EVS_PLAYBACK_KEY (playback:mint scope). Stored in Secrets Manager (and in state). Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_read_key" {
  description = "Optional EVS_READ_KEY (videos:read scope) for the admin video picker. Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_webhook_secret" {
  description = "Optional EVS_WEBHOOK_SECRET, verifying the webhooks EVS sends to webhook_urls.evs. Null: \"set-me\", replaced by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "video_origins" {
  description = "Origins lecture video streams from, for the web app's CSP (VIDEO_ORIGINS, joined with spaces), e.g. [\"https://video.example.com\", \"https://media.video.example.com\"]. Empty: the origin of evs_base_url when set."
  type        = list(string)
  default     = []
}

# ─── Network ─────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "VPC CIDR."
  type        = string
  default     = "10.70.0.0/16"
}

variable "az_count" {
  description = "Availability zones (2 or 3)."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper) instead of one per AZ (resilient)."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "KMS and Secrets Manager interface endpoints (traffic stays off NAT)."
  type        = bool
  default     = false
}

variable "flow_log_retention_days" {
  description = "VPC flow log retention; 0 disables flow logs."
  type        = number
  default     = 30
}

# ─── Edge ────────────────────────────────────────────────────────────────────

variable "enable_cdn" {
  description = "Put CloudFront in front of the load balancer (requires route53_zone_id)."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_cdn || var.route53_zone_id != null
    error_message = "enable_cdn needs route53_zone_id: the CloudFront certificate is validated through DNS."
  }
}

variable "enable_waf" {
  description = "Attach a WAF web ACL to CloudFront (with enable_cdn)."
  type        = bool
  default     = true
}

variable "alb_idle_timeout" {
  description = "Load balancer idle timeout in seconds: how long a request may go without a byte in either direction. 120 leaves room for slow AI drafting calls."
  type        = number
  default     = 120
}

variable "media_cors_extra_origins" {
  description = "Extra origins allowed to upload to the media bucket besides the app, e.g. [\"http://localhost:3530\"] for `make up-aws` against aws-dev. Keep empty in production."
  type        = list(string)
  default     = []
}

variable "alb_access_logs_bucket" {
  description = "Existing bucket for ALB access logs. Null disables them."
  type        = string
  default     = null
}

# ─── Data ────────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial storage (GiB)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Synchronous standby in a second AZ."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup (point-in-time recovery) retention."
  type        = number
  default     = 7
}

variable "db_monitoring_interval" {
  description = "Enhanced monitoring interval in seconds (0 disables)."
  type        = number
  default     = 60
}

variable "app_db_secret_arn" {
  description = "Secrets Manager secret ({\"username\",\"password\"} JSON, encrypted with the deployment's KMS key) of a non-master application role the api and worker connect as. Null: they use the RDS master user. The role is created by hand after the first deploy (docs/guides/operations.md, \"Least-privilege database role\"); migrate and admin keep the master user."
  type        = string
  default     = null
}

variable "app_db_username" {
  description = "Login of the application role (with app_db_secret_arn)."
  type        = string
  default     = null
  validation {
    condition     = (var.app_db_username == null) == (var.app_db_secret_arn == null)
    error_message = "Set app_db_secret_arn and app_db_username together (or neither)."
  }
}

variable "db_pool_max" {
  description = "Postgres connections per API or worker task (DB_POOL_MAX). Tasks x this must stay below the instance's max_connections."
  type        = number
  default     = 10
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "cache_node_count" {
  description = "Redis nodes: 1, or 2+ for a replica in another AZ with automatic failover."
  type        = number
  default     = 1
}

variable "cache_snapshot_retention_days" {
  description = "Daily Redis snapshots kept."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Protect the database and load balancer from deletion, keep a final snapshot, refuse to delete non-empty buckets and repositories."
  type        = bool
  default     = true
}

variable "kms_deletion_window_days" {
  description = "Waiting period before a scheduled KMS key deletion completes."
  type        = number
  default     = 30
}

variable "kms_admin_principal_arns" {
  description = "IAM principals allowed to administer the KMS key."
  type        = list(string)
  default     = []
}

variable "secret_recovery_window_days" {
  description = "Recovery window for deleted secrets."
  type        = number
  default     = 30
}

# ─── Applications ────────────────────────────────────────────────────────────

variable "migrate_on_boot" {
  description = "The API applies pending migrations at startup (advisory-locked). Default false: make aws-deploy runs the migrate task before rolling the services."
  type        = bool
  default     = false
}

variable "require_email_verification" {
  description = "New accounts must confirm their email address (REQUIRE_EMAIL_VERIFICATION)."
  type        = bool
  default     = true
}

variable "log_level" {
  description = "API and worker LOG_LEVEL."
  type        = string
  default     = "info"
}

variable "cpu_architecture" {
  description = "CPU architecture of every task: X86_64 (default) or ARM64 (Graviton, about 20% cheaper per vCPU). ARM64 needs images built for linux/arm64: deploy with PLATFORM=linux/arm64 make aws-deploy (scripts/aws-deploy.sh), or the tasks fail to start with an exec format error."
  type        = string
  default     = "X86_64"
  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "api_cpu" {
  description = "API task CPU units."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "API task memory (MiB)."
  type        = number
  default     = 1024
}

variable "api_min_count" {
  description = "Minimum API tasks."
  type        = number
  default     = 1
}

variable "api_max_count" {
  description = "Maximum API tasks."
  type        = number
  default     = 3
}

variable "worker_cpu" {
  description = "Worker task CPU units."
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Worker task memory (MiB). Image processing (sharp) runs here."
  type        = number
  default     = 1024
}

variable "worker_min_count" {
  description = "Minimum worker tasks."
  type        = number
  default     = 1
}

variable "worker_max_count" {
  description = "Maximum worker tasks."
  type        = number
  default     = 2
}

variable "web_cpu" {
  description = "Web app task CPU units."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Web app task memory (MiB)."
  type        = number
  default     = 512
}

variable "web_min_count" {
  description = "Minimum web app tasks."
  type        = number
  default     = 1
}

variable "web_max_count" {
  description = "Maximum web app tasks."
  type        = number
  default     = 3
}

variable "api_extra_environment" {
  description = "Extra API and worker environment variables, e.g. ACCESS_TOKEN_TTL_SECONDS or GEMINI_MODEL. Never put secrets here."
  type        = map(string)
  default     = {}
}

variable "api_extra_secrets" {
  description = "Extra API and worker secrets as ECS secret references, e.g. [{ name = \"GEMINI_API_KEY\", valueFrom = \"<secret arn>:GEMINI_API_KEY::\" }]. The execution role is granted read access to each one."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch log retention for every service."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Address that receives alarm notifications."
  type        = string
  default     = null
}
