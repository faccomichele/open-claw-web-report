
variable "tags" {
  description = "Map of tags to assign to resources"
  type        = map(string)
}

variable "cloudfront_price_class" {
  description = "CloudFront price class. PriceClass_100 = US/EU only (cheapest). See AWS docs for other options."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_All", "PriceClass_200", "PriceClass_100"], var.cloudfront_price_class)
    error_message = "Must be one of: PriceClass_All, PriceClass_200, PriceClass_100."
  }
}

variable "cloudfront_default_ttl" {
  description = "Default TTL (seconds) for CloudFront cached objects."
  type        = number
  default     = 300
}

variable "cloudfront_max_ttl" {
  description = "Maximum TTL (seconds) for CloudFront cached objects."
  type        = number
  default     = 3600
}

variable "enable_s3_versioning" {
  description = "Enable S3 versioning on the website bucket."
  type        = bool
  default     = true
}

variable "log_bucket_suffix" {
  description = "Additional suffix for the S3 access-logs bucket name to ensure global uniqueness."
  type        = string
  default     = ""
}
