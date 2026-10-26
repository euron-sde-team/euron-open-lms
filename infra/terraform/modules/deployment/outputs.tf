output "app_url" {
  description = "Public URL of the app (web and API on one host)."
  value       = local.app_url
}

output "cluster_name" {
  description = "ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "services" {
  description = "ECS service names."
  value       = { api = module.api.service_name, worker = module.worker.service_name, web = module.web.service_name }
}

output "ecr_repositories" {
  description = "Image repositories: api (also the worker and one-off tasks) and web."
  value       = module.ecr.repository_urls
}

output "migrate_task_definition_arn" {
  description = "Task definition of the one-off migration task."
  value       = module.migrate.task_definition_arn
}

output "admin_task_definition_arn" {
  description = "Task definition of the one-off admin bootstrap task (admin:create)."
  value       = module.admin.task_definition_arn
}

output "run_task" {
  description = "Everything `aws ecs run-task` needs for the one-off tasks (scripts/aws-run-task.sh)."
  value = {
    cluster = aws_ecs_cluster.this.name
    subnets = module.network.private_subnet_ids
    tasks = {
      migrate = { task_definition = module.migrate.task_definition_family, container = "migrate", security_groups = [module.migrate.security_group_id] }
      admin   = { task_definition = module.admin.task_definition_family, container = "admin", security_groups = [module.admin.security_group_id] }
    }
  }
}

output "media_bucket" {
  description = "Media bucket (S3_BUCKET)."
  value       = module.storage.bucket_name
}

output "redis_endpoint" {
  description = "Redis primary endpoint (the full REDIS_URL is in Secrets Manager)."
  value       = "${module.cache.primary_endpoint}:${module.cache.port}"
}

output "mail_configuration_set" {
  description = "SES configuration set (SES_CONFIGURATION_SET)."
  value       = module.email.configuration_set
}

output "mail_from" {
  description = "MAIL_FROM address."
  value       = module.email.from_address
}

output "load_balancer_dns_name" {
  description = "CNAME target for the app host when the zone is not in Route53."
  value       = module.edge.dns_name
}

output "certificate_validation_records" {
  description = "Records to publish by hand when the zone is not in Route53."
  value       = module.edge.certificate_validation_records
}

output "mail_dns_records" {
  description = "SES DKIM and MAIL FROM records to publish by hand when the zone is not in Route53."
  value       = module.email.dns_records
}

output "alarm_topic_arn" {
  description = "SNS topic receiving every alarm."
  value       = module.observability.alarm_topic_arn
}

output "webhook_urls" {
  description = "Endpoints to register in the provider dashboards: stripe (Stripe webhook endpoint), razorpay (Razorpay webhook) and evs (euron-video-system webhook)."
  value       = local.webhook_urls
}

output "payments_secret_name" {
  description = "Secrets Manager name holding the Stripe and Razorpay secrets (replace each \"set-me\" by hand), or null when no gateway is enabled."
  value       = var.enable_stripe || var.enable_razorpay ? "${var.name_prefix}/payments" : null
}

output "evs_secret_name" {
  description = "Secrets Manager name holding the euron-video-system keys (replace each \"set-me\" by hand), or null without evs_base_url."
  value       = local.with_evs ? "${var.name_prefix}/evs" : null
}
