variable "name_prefix" {
  description = "Prefix for every resource name. The bucket is <name_prefix>-media."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK for SSE-KMS. Null falls back to SSE-S3."
  type        = string
  default     = null
}

variable "cors_allowed_origins" {
  description = "Origins allowed to PUT and GET with presigned URLs (the web app origin, e.g. https://app.example.com). Empty: no CORS rule."
  type        = list(string)
  default     = []
}

variable "enforce_tls" {
  description = "Deny any request not made over TLS. Disable only for an emulator that speaks plain HTTP."
  type        = bool
  default     = true
}

variable "enable_versioning" {
  description = "Keep previous versions of overwritten or deleted objects."
  type        = bool
  default     = true
}

variable "noncurrent_version_days" {
  description = "Days a superseded object version is kept before it is removed."
  type        = number
  default     = 30
}

variable "force_destroy" {
  description = "Allow `terraform destroy` to delete a non-empty bucket. Never in production."
  type        = bool
  default     = false
}
