variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "vpc_id" {
  description = "VPC for the load balancer."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets, one per AZ."
  type        = list(string)
}

variable "hostnames" {
  description = "Host names served by the load balancer: { app = \"app.example.com\" }."
  type        = map(string)
}

variable "route53_zone_id" {
  description = "Hosted zone for the host names. When set, the certificate is validated and records are created automatically."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing ACM certificate covering every host name. Null requests a new one."
  type        = string
  default     = null
}

variable "create_dns_records" {
  description = "Point the host names at the load balancer (false when CloudFront owns them)."
  type        = bool
  default     = true
}

variable "allow_only_cloudfront" {
  description = "Accept traffic only from CloudFront's origin-facing ranges, and answer requests no service rule matched (no secret origin header) with 403 instead of 404."
  type        = bool
  default     = false
}

variable "access_logs_bucket" {
  description = "Bucket for ALB access logs. Null disables them."
  type        = string
  default     = null
}

variable "idle_timeout" {
  description = "Seconds a connection may stay idle (no bytes either way) before the load balancer closes it."
  type        = number
  default     = 120
  validation {
    condition     = var.idle_timeout >= 60 && var.idle_timeout <= 4000
    error_message = "idle_timeout must be between 60 and 4000 seconds."
  }
}

variable "deletion_protection" {
  description = "Protect the load balancer from deletion."
  type        = bool
  default     = false
}
