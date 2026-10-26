variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "hostnames" {
  description = "Host name per application (same map as the edge module)."
  type        = map(string)
}

variable "route53_zone_id" {
  description = "Hosted zone for the host names (required: the CDN certificate is DNS-validated)."
  type        = string
}

variable "origin_domain_name" {
  description = "Load balancer DNS name."
  type        = string
}

variable "origin_header_name" {
  description = "Name of the secret header CloudFront adds to every origin request."
  type        = string
  default     = "X-Origin-Verify"
}

variable "origin_header_value" {
  description = "Value of the secret origin header; the load balancer rules require it."
  type        = string
  sensitive   = true
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "enable_waf" {
  description = "Attach a WAF web ACL (managed rule sets + per-IP rate limit)."
  type        = bool
  default     = true
}

variable "rate_limit_per_5_minutes" {
  description = "Requests per IP per 5 minutes before the WAF blocks it."
  type        = number
  default     = 2000
}
