variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Environment tag."
  type        = string
  default     = "prod"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

variable "name_prefix" {
  description = "Prefix for every resource name; the bucket name derives from it, so make it globally unique (e.g. \"my-lms-prod\")."
  type        = string
}

variable "domain" {
  description = "The app host, e.g. app.example.com. Web and API (/api/*, including the webhooks) share it."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the domain (automatic certificates and DNS)."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional certificate, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "mail_domain" {
  description = "SES sending domain (defaults to domain)."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Image tag to deploy (make aws-deploy passes the git commit)."
  type        = string
}

variable "product_name" {
  description = "Product name shown in the app and emails."
  type        = string
  default     = "Euron Open LMS"
}

variable "enable_cdn" {
  description = "CloudFront (+ WAF) in front of the load balancer."
  type        = bool
  default     = true
}

variable "alarm_email" {
  description = "Alarm notification address."
  type        = string
  default     = null
}

variable "openai_api_key" {
  description = "Optional OpenAI key for quiz drafting, grading suggestions and polish (stored in Secrets Manager and in state). Prefer create_openai_secret and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "create_openai_secret" {
  description = "Create the OPENAI_API_KEY secret with a placeholder to replace by hand."
  type        = bool
  default     = false
}

variable "ai_provider" {
  description = "openai, gemini or none. Null: openai when a key is configured, otherwise none (AI features hidden)."
  type        = string
  default     = null
}

variable "enable_stripe" {
  description = "Sell through Stripe (creates <name_prefix>/payments; replace its \"set-me\" values by hand)."
  type        = bool
  default     = false
}

variable "stripe_publishable_key" {
  description = "STRIPE_PUBLISHABLE_KEY (not a secret)."
  type        = string
  default     = null
}

variable "stripe_secret_key" {
  description = "Optional STRIPE_SECRET_KEY (stored in Secrets Manager and in state). Prefer null and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Optional STRIPE_WEBHOOK_SECRET for the webhook_urls.stripe endpoint (stored in state). Prefer null and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "enable_razorpay" {
  description = "Sell through Razorpay (creates <name_prefix>/payments; needs razorpay_key_id)."
  type        = bool
  default     = false
}

variable "razorpay_key_id" {
  description = "RAZORPAY_KEY_ID (not a secret). Required with enable_razorpay."
  type        = string
  default     = null
}

variable "razorpay_key_secret" {
  description = "Optional RAZORPAY_KEY_SECRET (stored in state). Prefer null and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "razorpay_webhook_secret" {
  description = "Optional RAZORPAY_WEBHOOK_SECRET for the webhook_urls.razorpay endpoint (stored in state). Prefer null and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_base_url" {
  description = "euron-video-system API URL (EVS_BASE_URL). Set: creates <name_prefix>/evs. Null: EVS lectures cannot play."
  type        = string
  default     = null
}

variable "evs_playback_key" {
  description = "Optional EVS_PLAYBACK_KEY (stored in state). Prefer null and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_read_key" {
  description = "Optional EVS_READ_KEY for the admin video picker (stored in state)."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_webhook_secret" {
  description = "Optional EVS_WEBHOOK_SECRET for the webhook_urls.evs endpoint (stored in state)."
  type        = string
  default     = null
  sensitive   = true
}

variable "video_origins" {
  description = "Origins lecture video streams from (the web app's CSP). Empty: the origin of evs_base_url."
  type        = list(string)
  default     = []
}

variable "media_cors_extra_origins" {
  description = "Extra origins allowed to upload to the media bucket, e.g. [\"http://localhost:3530\"] for make up-aws."
  type        = list(string)
  default     = []
}

variable "api_extra_environment" {
  description = "Extra API and worker environment. Never secrets."
  type        = map(string)
  default     = {}
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.m7g.large"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton). ARM64 needs linux/arm64 images: PLATFORM=linux/arm64 make aws-deploy."
  type        = string
  default     = "X86_64"
}

variable "app_db_secret_arn" {
  description = "Secret of the least-privilege application database role (docs/guides/operations.md). Null: the api and worker use the RDS master user."
  type        = string
  default     = null
}

variable "app_db_username" {
  description = "Login of the application database role (with app_db_secret_arn)."
  type        = string
  default     = null
}

variable "openai_model" {
  description = "OPENAI_MODEL for quiz drafting, grading suggestions and polish."
  type        = string
  default     = "gpt-4o-mini"
}

variable "log_level" {
  description = "LOG_LEVEL for the api and worker."
  type        = string
  default     = "info"
}

variable "require_email_verification" {
  description = "REQUIRE_EMAIL_VERIFICATION: new accounts confirm their email before signing in."
  type        = bool
  default     = true
}


variable "api_extra_secrets" {
  description = "Extra ECS secrets for the api and worker, e.g. [{ name = \"GEMINI_API_KEY\", valueFrom = \"<secret arn>:GEMINI_API_KEY::\" }]."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}
