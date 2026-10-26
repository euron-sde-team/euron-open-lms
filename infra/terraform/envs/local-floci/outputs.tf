output "media_bucket" {
  description = "S3_BUCKET for the local stack."
  value       = module.storage.bucket_name
}

output "kms_key_alias" {
  description = "Alias of the key that encrypts the bucket and the secrets."
  value       = module.kms.alias_name
}

output "secret_arn" {
  description = "The emulated app secret (JWT_SECRET, REFRESH_SECRET); compose uses deploy/compose/.env instead."
  value       = module.secrets.secret_arn
}

output "mail_from" {
  description = "MAIL_FROM address registered in the emulator's SES."
  value       = module.email.from_address
}

output "mail_configuration_set" {
  description = "SES_CONFIGURATION_SET for the local stack."
  value       = module.email.configuration_set
}
