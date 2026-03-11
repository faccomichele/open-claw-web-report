###############################################################################
# Locals
###############################################################################
locals {
  # Unique bucket name based on project name + AWS account ID.
  # Account ID keeps names globally unique without requiring user input.
  website_bucket_name = "${local.project_name}-${local.environment}-${data.aws_caller_identity.current.account_id}"
  log_bucket_name     = "${local.project_name}-cloudfront-logs-${local.environment}-${data.aws_caller_identity.current.account_id}${var.log_bucket_suffix}"

  # S3 key prefix used to store flow JSON data files inside the website bucket.
  data_prefix = "data/"
}

###############################################################################
# Data sources
###############################################################################
data "aws_caller_identity" "current" {}

###############################################################################
# S3 — Website bucket
###############################################################################
resource "aws_s3_bucket" "website" {
  bucket = local.website_bucket_name
}

resource "aws_s3_bucket_versioning" "website" {
  bucket = aws_s3_bucket.website.id

  versioning_configuration {
    status = var.enable_s3_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block all public access — CloudFront uses OAC to reach the bucket privately.
resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS — allows the web page (served via CloudFront) to fetch JSON data
# from the same bucket via the same CloudFront origin (same-origin requests).
# Only needed if a separate origin is ever used; included for completeness.
resource "aws_s3_bucket_cors_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

###############################################################################
# S3 — Access logs bucket
###############################################################################
resource "aws_s3_bucket" "logs" {
  bucket = local.log_bucket_name
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

###############################################################################
# CloudFront — Origin Access Control (OAC)
###############################################################################
resource "aws_cloudfront_origin_access_control" "website" {
  name                              = "${local.project_name}-oac"
  description                       = "OAC for ${local.project_name} website bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

###############################################################################
# CloudFront — Distribution
###############################################################################
resource "aws_cloudfront_distribution" "website" {
  enabled             = true
  comment             = "${local.project_name} (${local.environment})"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  http_version        = "http2"

  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id                = "s3-${local.website_bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.website.id
  }

  # Default cache behaviour — serves the static web application.
  default_cache_behavior {
    target_origin_id       = "s3-${local.website_bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    default_ttl = var.cloudfront_default_ttl
    max_ttl     = var.cloudfront_max_ttl
    min_ttl     = 0
  }

  # Dedicated cache behaviour for JSON data files — short TTL so that new
  # flow data uploaded to S3 is reflected quickly in the browser.
  ordered_cache_behavior {
    path_pattern           = "/data/*"
    target_origin_id       = "s3-${local.website_bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    default_ttl = 30
    max_ttl     = 60
    min_ttl     = 0
  }

  # Serve index.html for any path that doesn't match a real S3 key,
  # enabling client-side routing if extended in the future.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  depends_on = [aws_s3_bucket_public_access_block.website]
}

###############################################################################
# S3 Bucket Policy — allow CloudFront OAC to read objects
###############################################################################
data "aws_iam_policy_document" "website_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontOACRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.website.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.website.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "website" {
  bucket = aws_s3_bucket.website.id
  policy = data.aws_iam_policy_document.website_bucket_policy.json

  depends_on = [aws_s3_bucket_public_access_block.website]
}
