# ─────────────────────────────────────────────────────────────
# Crypto Vision — Terraform Configuration
#
# Provisions the full GCP infrastructure for cryptocurrency.cv
# ─────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  # Store state in GCS — create bucket first:
  #   gsutil mb -l us-central1 gs://${PROJECT}-terraform-state
  backend "gcs" {
    bucket = "crypto-vision-terraform-state"
    prefix = "infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
