output "primary_endpoint" {
  description = "Primary endpoint address (writes; the replica takes it over on failover)."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Redis port."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "Redis security group; consumers add ingress rules against it."
  value       = aws_security_group.this.id
}

output "secret_arn" {
  description = "Secrets Manager secret holding REDIS_URL."
  value       = aws_secretsmanager_secret.url.arn
}

output "secret_refs" {
  description = "ECS container `secrets` entry for REDIS_URL."
  value       = [{ name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.url.arn}:REDIS_URL::" }]
}
