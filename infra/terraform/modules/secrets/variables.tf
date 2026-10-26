variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK that encrypts the secrets. Null uses the AWS-managed key."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. 0 deletes immediately (local and throwaway environments)."
  type        = number
  default     = 30
}

variable "create_openai_secret" {
  description = "Create the <prefix>/openai secret. A plain boolean so the decision is known at plan time even though the key itself is sensitive."
  type        = bool
  default     = false
}

variable "openai_api_key" {
  description = "Initial OPENAI_API_KEY value. Null writes a placeholder to replace by hand, which keeps the key out of Terraform state."
  type        = string
  default     = null
  sensitive   = true
}

# ─── Payments (Stripe, Razorpay) ─────────────────────────────────────────────

variable "enable_stripe" {
  description = "Inject the Stripe keys of the <prefix>/payments secret (created when either gateway is enabled). A plain boolean, known at plan time."
  type        = bool
  default     = false
}

variable "enable_razorpay" {
  description = "Inject the Razorpay keys of the <prefix>/payments secret (created when either gateway is enabled). A plain boolean, known at plan time."
  type        = bool
  default     = false
}

variable "stripe_secret_key" {
  description = "Initial STRIPE_SECRET_KEY. Null writes the placeholder \"set-me\" to replace by hand, which keeps the key out of Terraform state."
  type        = string
  default     = null
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Initial STRIPE_WEBHOOK_SECRET (the endpoint's signing secret, whsec_...). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

variable "razorpay_key_secret" {
  description = "Initial RAZORPAY_KEY_SECRET. Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

variable "razorpay_webhook_secret" {
  description = "Initial RAZORPAY_WEBHOOK_SECRET (chosen when the webhook is created in the Razorpay dashboard). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

# ─── Video (euron-video-system) ──────────────────────────────────────────────

variable "create_evs_secret" {
  description = "Create the <prefix>/evs secret and inject it. A plain boolean so the decision is known at plan time."
  type        = bool
  default     = false
}

variable "evs_playback_key" {
  description = "Initial EVS_PLAYBACK_KEY (an EVS API key with the playback:mint scope). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_read_key" {
  description = "Initial EVS_READ_KEY (optional, videos:read scope, powers the admin video picker). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

variable "evs_webhook_secret" {
  description = "Initial EVS_WEBHOOK_SECRET (verifies video.ready and video.failed webhooks). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}

# ─── Push notifications (FCM) ────────────────────────────────────────────────

variable "create_push_secret" {
  description = "Create the <prefix>/push secret and inject FCM_SERVICE_ACCOUNT_JSON. A plain boolean so the decision is known at plan time."
  type        = bool
  default     = false
}

variable "fcm_service_account_json" {
  description = "Initial FCM_SERVICE_ACCOUNT_JSON (a Google service account key allowed to send FCM messages). Null writes \"set-me\"."
  type        = string
  default     = null
  sensitive   = true
}
