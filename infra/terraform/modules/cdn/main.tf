# CloudFront in front of the load balancer, for the app host.
#
#   /_next/static/*   immutable build assets, cached at the edge for a year
#   /api/*            the API (including /api/webhooks/*): never cached; every header
#                     (Cookie, Authorization, Host, the gateways' signature headers),
#                     cookie and query string goes to the origin, and the body is passed
#                     through byte for byte (webhook signatures cover the raw body)
#   everything else   the web app, not cached, same forwarding
#
# The Host header is forwarded so the load balancer's host rules still match, and a
# secret origin header is added so the load balancer refuses requests that skip the CDN.
# Optional WAF: the AWS managed common and known-bad-inputs rule sets, plus a per-IP
# rate limit. Lecture video never passes through here: it streams from
# euron-video-system on its own origin.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

locals {
  hostnames = [for h in values(var.hostnames) : h]
}

resource "aws_acm_certificate" "edge" {
  provider                  = aws.us_east_1
  domain_name               = local.hostnames[0]
  subject_alternative_names = slice(local.hostnames, 1, length(local.hostnames))
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.edge.domain_validation_options : o.domain_name => o
  }
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "edge" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.edge.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_wafv2_web_acl" "this" {
  #checkov:skip=CKV2_AWS_31:WAF logging needs a Firehose or bucket the operator chooses; sampled requests and metrics are on.
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1
  name     = "${var.name_prefix}-edge"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Lesson content, quiz definitions and assignment answers can pass 8 KB. Files
        # never do: they go straight to S3 with presigned URLs, not through CloudFront.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
        # Payment and video webhooks (POST /api/webhooks/stripe, /razorpay, /evs) skip
        # this rule set. Their raw JSON bodies (up to 1 MB) carry customer-entered text
        # (names, addresses, course titles) that the body rules for XSS, SQLi and LFI
        # can misread as an attack, and a blocked webhook means a paid order is never
        # confirmed. They are not left unchecked: the API verifies each provider's HMAC
        # signature over the raw body before reading it, the known-bad-inputs rule set
        # and the per-IP rate limit below still apply to them, and the API caps the body
        # size itself. (CloudFront's WAF only inspects the first 16 KB of a body anyway.)
        scope_down_statement {
          not_statement {
            statement {
              byte_match_statement {
                search_string         = "/api/webhooks/"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5_minutes
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-edge"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_86:Access logging needs a log bucket the operator chooses; CloudWatch metrics are on.
  #checkov:skip=CKV_AWS_310:Origin failover needs a second origin; a single regional deployment has one.
  #checkov:skip=CKV_AWS_374:Geo restriction is a business decision per deployment.
  #checkov:skip=CKV2_AWS_47:Log4j protection comes from AWSManagedRulesKnownBadInputsRuleSet when enable_waf is true.
  #checkov:skip=CKV2_AWS_32:The managed security-headers policy is attached to every behavior.
  #checkov:skip=CKV_AWS_305:Every origin is an application that serves "/" itself; a root object would shadow it.
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} edge"
  aliases         = local.hostnames
  price_class     = var.price_class
  web_acl_id      = var.enable_waf ? aws_wafv2_web_acl.this[0].arn : null
  http_version    = "http2and3"

  origin {
    origin_id   = "alb"
    domain_name = var.origin_domain_name
    # Proves to the load balancer that the request came through this distribution.
    # CloudFront overwrites a viewer-supplied header of the same name.
    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # CloudFront's maximum without a quota increase; slow AI drafting calls fit in it.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id           = "alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "alb"
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = false
      cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = "alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.edge.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "hosts" {
  for_each = var.hostnames
  zone_id  = var.route53_zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "hosts_ipv6" {
  for_each = var.hostnames
  zone_id  = var.route53_zone_id
  name     = each.value
  type     = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
