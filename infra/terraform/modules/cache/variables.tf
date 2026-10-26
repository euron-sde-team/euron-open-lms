variable "name_prefix" {
  description = "Prefix for every resource name. The replication group is <name_prefix>-redis."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the cache subnet group (one per AZ)."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "CMK for at-rest encryption, the slow-log group and the REDIS_URL secret."
  type        = string
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "Node type, e.g. cache.t4g.small (dev) or cache.m7g.large (prod)."
  type        = string
  default     = "cache.t4g.small"
}

variable "node_count" {
  description = "Nodes in the replication group: 1 (single node) or 2+ (primary + replicas across AZs, automatic failover)."
  type        = number
  default     = 1
  validation {
    condition     = var.node_count >= 1 && var.node_count <= 6
    error_message = "node_count must be between 1 and 6."
  }
}

variable "snapshot_retention_days" {
  description = "Daily snapshots kept (0 disables). Queued jobs survive a total cache loss only through these."
  type        = number
  default     = 7
}

variable "apply_immediately" {
  description = "Apply modifications now instead of in the maintenance window."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Slow-log retention in CloudWatch Logs."
  type        = number
  default     = 30
}

variable "secret_recovery_window_days" {
  description = "Recovery window for the deleted REDIS_URL secret."
  type        = number
  default     = 30
}

variable "enable_alarms" {
  description = "Create the CPU, memory, evictions and connections alarms. A boolean because the topic ARN is unknown until apply."
  type        = bool
  default     = true
}

variable "alarm_topic_arn" {
  description = "SNS topic the alarms notify (with enable_alarms)."
  type        = string
  default     = null
}

variable "max_connections_alarm" {
  description = "Connection count that raises an alarm. Each API task holds about four connections and each worker one per queue."
  type        = number
  default     = 1000
}
