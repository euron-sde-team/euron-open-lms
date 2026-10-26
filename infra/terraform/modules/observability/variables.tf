variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "alarm_email" {
  description = "Address subscribed to alarm notifications (confirm the e-mail AWS sends). Null: subscribe something else to the topic."
  type        = string
  default     = null
}

variable "alb_arn_suffix" {
  description = "Load balancer ARN suffix."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "services" {
  description = "Services to watch: { api = { service_name, load_balanced = true, target_group_arn_suffix }, worker = { service_name, load_balanced = false }, ... }."
  type = map(object({
    service_name            = string
    load_balanced           = bool
    target_group_arn_suffix = optional(string)
  }))
}

variable "db_instance_identifier" {
  description = "RDS instance identifier."
  type        = string
}

variable "db_max_connections" {
  description = "Connection ceiling the alarm measures against."
  type        = number
  default     = 200
}

variable "worker_log_group_name" {
  description = "Worker log group; a metric filter on it counts failed job attempts."
  type        = string
}

variable "failed_jobs_threshold" {
  description = "Failed job attempts in 5 minutes above which the failed-jobs alarm fires."
  type        = number
  default     = 5
}
