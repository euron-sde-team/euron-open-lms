output "app_url" {
  description = "Public URL of the app."
  value       = module.lms.app_url
}

output "cluster_name" {
  description = "ECS cluster."
  value       = module.lms.cluster_name
}

output "services" {
  description = "ECS service names (api, worker, web)."
  value       = module.lms.services
}

output "ecr_repositories" {
  description = "Image repositories (api, web)."
  value       = module.lms.ecr_repositories
}

output "migrate_task_definition_arn" {
  description = "One-off migration task definition."
  value       = module.lms.migrate_task_definition_arn
}

output "admin_task_definition_arn" {
  description = "One-off admin bootstrap task definition."
  value       = module.lms.admin_task_definition_arn
}

output "run_task" {
  description = "Parameters for the one-off tasks (scripts/aws-run-task.sh)."
  value       = module.lms.run_task
}

output "media_bucket" {
  description = "Media bucket."
  value       = module.lms.media_bucket
}

output "redis_endpoint" {
  description = "Redis primary endpoint."
  value       = module.lms.redis_endpoint
}

output "mail_configuration_set" {
  description = "SES configuration set."
  value       = module.lms.mail_configuration_set
}

output "load_balancer_dns_name" {
  description = "CNAME target when the zone is not in Route53."
  value       = module.lms.load_balancer_dns_name
}

output "certificate_validation_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.lms.certificate_validation_records
}

output "mail_dns_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.lms.mail_dns_records
}

output "webhook_urls" {
  description = "Register these in the Stripe and Razorpay dashboards and in euron-video-system: { stripe, razorpay, evs }."
  value       = module.lms.webhook_urls
}

output "payments_secret_name" {
  description = "Secret holding the gateway keys (replace each \"set-me\"), or null."
  value       = module.lms.payments_secret_name
}

output "evs_secret_name" {
  description = "Secret holding the euron-video-system keys (replace each \"set-me\"), or null."
  value       = module.lms.evs_secret_name
}
