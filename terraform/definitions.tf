locals {
  environment        = split("_", terraform.workspace)[0]
  aws_region         = split("_", terraform.workspace)[1]
  project_name       = var.tags["Project"] != null ? var.tags["Project"] : "unknown"
  log_retention_days = local.environment == "dev" ? 7 : 30
}
