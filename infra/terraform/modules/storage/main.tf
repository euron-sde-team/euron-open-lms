# One private bucket for every user-uploaded file: avatars, banners, post and message
# attachments. Nothing is public. The browser uploads straight to the bucket with a
# short-lived presigned PUT and reads through presigned GETs the API issues after its
# own permission check, which is why the bucket carries a CORS rule for the app origin
# and nothing else.
resource "aws_s3_bucket" "media" {
  #checkov:skip=CKV_AWS_144:Cross-region replication is an organisation-level DR decision; enable it per deployment.
  #checkov:skip=CKV_AWS_18:Access logging targets a separate log bucket an operator chooses; CloudTrail data events cover object access.
  #checkov:skip=CKV2_AWS_62:No consumer for S3 event notifications: the API confirms uploads itself.
  #checkov:skip=CKV_AWS_21:Versioning is an input (enable_versioning, on in every AWS environment); off only for the local emulator.
  bucket        = "${var.name_prefix}-media"
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Versioning gives a recovery window for media a bug or a compromised session deletes.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = var.kms_key_arn != null
  }
}

# Browser uploads: presigned PUTs from the app origin with the Content-Type the API
# signed, and presigned GETs for display. ETag is exposed so multipart clients work.
resource "aws_s3_bucket_cors_configuration" "media" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  # An upload abandoned halfway leaves invisible parts that are still billed.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Deleted or replaced media (an old avatar, a removed post's image) is kept for a
  # recovery window, then removed for good. Current objects never expire here: the
  # API's own cleanup job deletes media that was never attached to anything.
  rule {
    id     = "expire-noncurrent"
    status = var.enable_versioning ? "Enabled" : "Disabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
  }
}

data "aws_iam_policy_document" "media" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  count      = var.enforce_tls ? 1 : 0
  bucket     = aws_s3_bucket.media.id
  policy     = data.aws_iam_policy_document.media.json
  depends_on = [aws_s3_bucket_public_access_block.media]
}
