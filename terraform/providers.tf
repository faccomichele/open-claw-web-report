terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure to store state remotely in S3.
  # backend "s3" {
  #   bucket = "<your-terraform-state-bucket>"
  #   key    = "open-claw-web-report/terraform.tfstate"
  #   region = "<your-aws-region>"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "open-claw-web-report"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
