variable "endpoint" {
  description = "Emulator endpoint: http://localhost:4597 from the host, http://floci:4566 inside compose."
  type        = string
  default     = "http://localhost:4597"
}

variable "name_prefix" {
  description = "Must match S3_BUCKET and SES_CONFIGURATION_SET in deploy/compose/compose.floci.yaml."
  type        = string
  default     = "open-lms-local"
}

variable "mail_domain" {
  description = "Sending domain registered in the emulator's SES (must match MAIL_FROM in deploy/compose/compose.yaml)."
  type        = string
  default     = "lms.example.test"
}

variable "app_origin" {
  description = "Origin of the local web app, allowed to upload to the media bucket."
  type        = string
  default     = "http://localhost:3530"
}
