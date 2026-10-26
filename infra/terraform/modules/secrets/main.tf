# Application secrets in Secrets Manager. ECS injects each JSON key into the API and
# worker containers as an environment variable; the values never appear in a task
# definition or a log.
#
#   <prefix>/app      JWT_SECRET, REFRESH_SECRET: generated here, 64 characters each.
#                     Distinct on purpose (the API refuses to boot if they are equal), so
#                     access tokens and refresh tokens can be rotated independently.
#   <prefix>/totp     TOTP_ENCRYPTION_KEY: 32 random bytes, base64. Encrypts the TOTP
#                     secrets at rest. Its own secret (not a key in <prefix>/app) so an
#                     existing deployment gains it on the next apply: the app secret's
#                     value is ignore_changes. Rotating it invalidates every enrolled
#                     authenticator, so it is not rotated with the signing keys.
#   <prefix>/openai   OPENAI_API_KEY: only when create_openai_secret is true. The value
#                     can come from var.openai_api_key or be put in by hand afterwards
#                     (aws secretsmanager put-secret-value), which keeps it out of state.
#   <prefix>/payments STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RAZORPAY_KEY_SECRET,
#                     RAZORPAY_WEBHOOK_SECRET: only when enable_stripe or enable_razorpay
#                     is true. All four keys are always written (unset ones as "set-me"),
#                     so enabling the second gateway later needs no change to the JSON
#                     shape, only real values; only the enabled gateways' keys are
#                     injected. The API treats "set-me" as not configured and refuses to
#                     sell through that gateway until an operator puts the real value.
#   <prefix>/evs      EVS_PLAYBACK_KEY, EVS_READ_KEY, EVS_WEBHOOK_SECRET for
#                     euron-video-system: only when create_evs_secret is true (an EVS
#                     base URL is configured). Same placeholder rule.
#   <prefix>/push     FCM_SERVICE_ACCOUNT_JSON: the Google service account key the API
#                     signs FCM HTTP v1 requests with (push notifications to the mobile
#                     app): only when create_push_secret is true (push_provider = "fcm").
#                     Same placeholder rule.
#
# Every third-party value follows the openai pattern: pass it as a sensitive variable
# (it then lands in Terraform state), or leave it null and replace "set-me" by hand
# (aws secretsmanager put-secret-value with the full JSON object). Terraform never
# overwrites a value afterwards: secret_string is ignore_changes.
#
# REDIS_URL lives in the cache module's own secret, next to the auth token it embeds.
resource "random_password" "app" {
  for_each = toset(["JWT_SECRET", "REFRESH_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:These are HMAC signing keys; rotation is an operator procedure (put a new version, roll the services), not a Lambda.
  name                    = "${var.name_prefix}/app"
  description             = "API signing secrets (access and refresh tokens)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ for k, v in random_password.app : k => v.result })

  # Rotation happens out of band (put a new version by hand or by pipeline). Without
  # this, the next `terraform apply` would quietly roll every secret back.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "random_bytes" "totp" {
  length = 32
}

resource "aws_secretsmanager_secret" "totp" {
  #checkov:skip=CKV2_AWS_57:A data-encryption key for stored TOTP secrets; rotating it needs a re-encryption, not a Lambda.
  name                    = "${var.name_prefix}/totp"
  description             = "Key that encrypts stored TOTP secrets (TOTP_ENCRYPTION_KEY)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "totp" {
  secret_id     = aws_secretsmanager_secret.totp.id
  secret_string = jsonencode({ TOTP_ENCRYPTION_KEY = random_bytes.totp.base64 })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "openai" {
  #checkov:skip=CKV2_AWS_57:A third-party API key; it is rotated at the provider, then put here by hand.
  count                   = var.create_openai_secret ? 1 : 0
  name                    = "${var.name_prefix}/openai"
  description             = "OpenAI API key for quiz drafting, grading suggestions and polish (OPENAI_API_KEY)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "openai" {
  count         = var.create_openai_secret ? 1 : 0
  secret_id     = aws_secretsmanager_secret.openai[0].id
  secret_string = jsonencode({ OPENAI_API_KEY = coalesce(var.openai_api_key, "set-me") })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "payments" {
  #checkov:skip=CKV2_AWS_57:Third-party gateway keys; they are rotated in the Stripe or Razorpay dashboard, then put here by hand.
  count                   = local.create_payments ? 1 : 0
  name                    = "${var.name_prefix}/payments"
  description             = "Payment gateway secrets (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "payments" {
  count     = local.create_payments ? 1 : 0
  secret_id = aws_secretsmanager_secret.payments[0].id
  secret_string = jsonencode({
    STRIPE_SECRET_KEY       = coalesce(var.stripe_secret_key, "set-me")
    STRIPE_WEBHOOK_SECRET   = coalesce(var.stripe_webhook_secret, "set-me")
    RAZORPAY_KEY_SECRET     = coalesce(var.razorpay_key_secret, "set-me")
    RAZORPAY_WEBHOOK_SECRET = coalesce(var.razorpay_webhook_secret, "set-me")
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "evs" {
  #checkov:skip=CKV2_AWS_57:API keys issued by euron-video-system; they are rotated there, then put here by hand.
  count                   = var.create_evs_secret ? 1 : 0
  name                    = "${var.name_prefix}/evs"
  description             = "euron-video-system keys (EVS_PLAYBACK_KEY, EVS_READ_KEY, EVS_WEBHOOK_SECRET)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "evs" {
  count     = var.create_evs_secret ? 1 : 0
  secret_id = aws_secretsmanager_secret.evs[0].id
  secret_string = jsonencode({
    EVS_PLAYBACK_KEY   = coalesce(var.evs_playback_key, "set-me")
    EVS_READ_KEY       = coalesce(var.evs_read_key, "set-me")
    EVS_WEBHOOK_SECRET = coalesce(var.evs_webhook_secret, "set-me")
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "push" {
  #checkov:skip=CKV2_AWS_57:A Google service account key; it is rotated in the Google Cloud console, then put here by hand.
  count                   = var.create_push_secret ? 1 : 0
  name                    = "${var.name_prefix}/push"
  description             = "Firebase Cloud Messaging service account for mobile push (FCM_SERVICE_ACCOUNT_JSON)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "push" {
  count         = var.create_push_secret ? 1 : 0
  secret_id     = aws_secretsmanager_secret.push[0].id
  secret_string = jsonencode({ FCM_SERVICE_ACCOUNT_JSON = coalesce(var.fcm_service_account_json, "set-me") })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  create_payments = var.enable_stripe || var.enable_razorpay
  payment_keys = concat(
    var.enable_stripe ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] : [],
    var.enable_razorpay ? ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] : [],
  )
  evs_keys = ["EVS_PLAYBACK_KEY", "EVS_READ_KEY", "EVS_WEBHOOK_SECRET"]

  totp_ref = { name = "TOTP_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.totp.arn}:TOTP_ENCRYPTION_KEY::" }
  refs = concat(
    [for k in sort(keys(random_password.app)) : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [local.totp_ref],
    [for s in aws_secretsmanager_secret.openai : { name = "OPENAI_API_KEY", valueFrom = "${s.arn}:OPENAI_API_KEY::" }],
    flatten([for s in aws_secretsmanager_secret.payments : [for k in local.payment_keys : { name = k, valueFrom = "${s.arn}:${k}::" }]]),
    flatten([for s in aws_secretsmanager_secret.evs : [for k in local.evs_keys : { name = k, valueFrom = "${s.arn}:${k}::" }]]),
    [for s in aws_secretsmanager_secret.push : { name = "FCM_SERVICE_ACCOUNT_JSON", valueFrom = "${s.arn}:FCM_SERVICE_ACCOUNT_JSON::" }],
  )
}
