output "secret_arn" {
  description = "ARN of the JSON secret holding JWT_SECRET and REFRESH_SECRET."
  value       = aws_secretsmanager_secret.app.arn
}

output "openai_secret_arn" {
  description = "ARN of the OPENAI_API_KEY secret, or null when it is not created."
  value       = var.create_openai_secret ? aws_secretsmanager_secret.openai[0].arn : null
}

output "secret_refs" {
  description = "ECS container `secrets` entries (signing keys, TOTP key, and the OpenAI, payment, EVS and FCM keys that are enabled): [{ name, valueFrom = \"<arn>:<json key>::\" }]."
  value       = local.refs
}

output "totp_secret_arn" {
  description = "ARN of the TOTP_ENCRYPTION_KEY secret."
  value       = aws_secretsmanager_secret.totp.arn
}

output "totp_secret_ref" {
  description = "ECS container `secrets` entry for TOTP_ENCRYPTION_KEY alone (one-off tasks that need it without the signing keys)."
  value       = local.totp_ref
}

output "payments_secret_arn" {
  description = "ARN of the <prefix>/payments secret (Stripe and Razorpay keys), or null when no gateway is enabled."
  value       = local.create_payments ? aws_secretsmanager_secret.payments[0].arn : null
}

output "evs_secret_arn" {
  description = "ARN of the <prefix>/evs secret (euron-video-system keys), or null when it is not created."
  value       = var.create_evs_secret ? aws_secretsmanager_secret.evs[0].arn : null
}

output "push_secret_arn" {
  description = "ARN of the <prefix>/push secret (FCM service account), or null when it is not created."
  value       = var.create_push_secret ? aws_secretsmanager_secret.push[0].arn : null
}
