output "cloudfront_domain_name" {
  description = "Public domain name of the CloudFront distribution. Use this URL to access the web report."
  value       = "https://${aws_cloudfront_distribution.website.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Use this when running `aws cloudfront create-invalidation`."
  value       = aws_cloudfront_distribution.website.id
}

output "website_bucket_name" {
  description = "Name of the S3 bucket that hosts the website and JSON data."
  value       = aws_s3_bucket.website.id
}

output "website_bucket_arn" {
  description = "ARN of the website S3 bucket."
  value       = aws_s3_bucket.website.arn
}

output "log_bucket_name" {
  description = "Name of the S3 bucket that stores CloudFront access logs."
  value       = aws_s3_bucket.logs.id
}

output "data_s3_key_prefix" {
  description = "S3 key prefix where JSON flow data files are stored (e.g. `data/flows.json`)."
  value       = local.data_prefix
}
