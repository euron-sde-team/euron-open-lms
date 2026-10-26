output "bucket_name" {
  description = "Media bucket name (S3_BUCKET)."
  value       = aws_s3_bucket.media.bucket
}

output "bucket_arn" {
  description = "Media bucket ARN, for IAM policies."
  value       = aws_s3_bucket.media.arn
}
