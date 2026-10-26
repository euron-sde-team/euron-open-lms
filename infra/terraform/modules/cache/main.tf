# ElastiCache for Redis 7: the BullMQ queues behind every background job (run by the
# worker) and the rate-limit counters shared by all API tasks.
#
#   - private subnets only; the security group has no rules of its own: each consumer
#     (the api and worker services) adds an ingress rule from its task security group,
#     the same pattern as the database, so access is granted per service, never by CIDR
#   - TLS in transit plus an AUTH token, encrypted at rest with the deployment's CMK
#   - more than one node: a replica in another AZ with automatic failover
#   - the full rediss:// URL (token included) is stored in Secrets Manager and injected
#     into the containers as REDIS_URL, because ECS cannot compose a URL from parts
#
# BullMQ requires maxmemory-policy noeviction: an evicted job key is a lost job. The
# evictions alarm therefore means "out of memory", not "cache doing its job".
locals {
  id       = "${var.name_prefix}-redis"
  failover = var.node_count > 1
  members  = [for i in range(var.node_count) : format("%s-%03d", local.id, i + 1)]
}

resource "aws_elasticache_subnet_group" "this" {
  name       = local.id
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "this" {
  name        = local.id
  description = "Redis; ingress only from application security groups"
  vpc_id      = var.vpc_id
  tags        = { Name = local.id }
}

resource "aws_elasticache_parameter_group" "this" {
  name   = local.id
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# ElastiCache AUTH tokens: 16 to 128 printable characters, none of @, " or /.
resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "aws_cloudwatch_log_group" "slow" {
  #checkov:skip=CKV_AWS_338:Retention is an input (log_retention_days); aws-prod keeps 365 days.
  name              = "/open-lms/${var.name_prefix}/redis-slow"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = local.id
  description          = "${var.name_prefix}: job queues and rate limits"
  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.node_count
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.this.name
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.this.id]

  automatic_failover_enabled = local.failover
  multi_az_enabled           = local.failover

  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = random_password.auth.result
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window            = "02:00-03:00"
  maintenance_window         = "sun:05:30-sun:06:30"
  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }
}

resource "aws_secretsmanager_secret" "url" {
  #checkov:skip=CKV2_AWS_57:The AUTH token rotates through Terraform (taint random_password.auth, apply, roll the services), not a Lambda.
  name                    = "${var.name_prefix}/redis"
  description             = "REDIS_URL (rediss:// with the AUTH token) for the api and worker"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "url" {
  secret_id = aws_secretsmanager_secret.url.id
  secret_string = jsonencode({
    REDIS_URL = "rediss://:${random_password.auth.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:${aws_elasticache_replication_group.this.port}"
  })
}

# ─── Alarms ──────────────────────────────────────────────────────────────────

locals {
  alarms = merge([
    for member in local.members : {
      "${member}-cpu" = {
        description = "Redis ${member}: engine CPU sustained above 80%"
        metric      = "EngineCPUUtilization"
        stat        = "Average"
        threshold   = 80
        comparison  = "GreaterThanThreshold"
        member      = member
      }
      "${member}-memory" = {
        description = "Redis ${member}: memory above 80% of maxmemory (noeviction: writes fail at 100%)"
        metric      = "DatabaseMemoryUsagePercentage"
        stat        = "Maximum"
        threshold   = 80
        comparison  = "GreaterThanThreshold"
        member      = member
      }
      "${member}-evictions" = {
        description = "Redis ${member}: keys evicted (should never happen with noeviction)"
        metric      = "Evictions"
        stat        = "Sum"
        threshold   = 0
        comparison  = "GreaterThanThreshold"
        member      = member
      }
      "${member}-connections" = {
        description = "Redis ${member}: connections above ${var.max_connections_alarm}"
        metric      = "CurrConnections"
        stat        = "Maximum"
        threshold   = var.max_connections_alarm
        comparison  = "GreaterThanThreshold"
        member      = member
      }
    }
  ]...)
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = var.enable_alarms ? local.alarms : {}
  alarm_name          = "${var.name_prefix}-redis-${trimprefix(each.key, "${local.id}-")}"
  alarm_description   = each.value.description
  namespace           = "AWS/ElastiCache"
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = { CacheClusterId = each.value.member }
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  depends_on          = [aws_elasticache_replication_group.this]
}
