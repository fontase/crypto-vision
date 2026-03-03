# ─────────────────────────────────────────────────────────────
# Export Pipeline — GCS Bucket + Cloud Scheduler
#
# Provisions:
#   1. A versioned GCS bucket for all exported artifacts
#   2. A weekly Cloud Scheduler job to trigger full export
#   3. Lifecycle rules to manage storage costs
#
# The export endpoint (POST /api/admin/export) is authenticated
# via OIDC token from the scheduler service account.
# ─────────────────────────────────────────────────────────────

# ─── Export Bucket ────────────────────────────────────────────

resource "google_storage_bucket" "exports" {
  name          = "${var.project_id}-exports"
  project       = var.project_id
  location      = "US"
  storage_class = "STANDARD"
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  # Lifecycle: move old exports to cheaper storage, then delete
  lifecycle_rule {
    condition {
      age = 30 # After 30 days → Nearline
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 90 # After 90 days → Coldline
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365 # After 1 year → Delete
    }
    action {
      type = "Delete"
    }
  }

  # Keep only 3 versions of each object (manifest rewrites, etc.)
  lifecycle_rule {
    condition {
      num_newer_versions = 3
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    service     = "crypto-vision"
    purpose     = "export"
    managed_by  = "terraform"
  }
}

# ─── Grant Cloud Run SA write access to export bucket ─────────

resource "google_storage_bucket_iam_member" "export_writer" {
  bucket = google_storage_bucket.exports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ─── Weekly Export Scheduler Job ──────────────────────────────

resource "google_cloud_scheduler_job" "weekly_export" {
  name             = "weekly-full-export"
  project          = var.project_id
  region           = var.region
  description      = "Trigger full artifact export every Sunday at 02:00 UTC"
  schedule         = "0 2 * * 0"
  time_zone        = "UTC"
  attempt_deadline = "1800s" # 30 minutes max

  retry_config {
    retry_count          = 2
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  http_target {
    uri         = "${google_cloud_run_v2_service.app.uri}/api/admin/export"
    http_method = "POST"

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.app.uri
    }
  }

  depends_on = [google_project_service.apis]
}

# ─── Daily Export (Month 5.5+ — Closer to Credit Expiry) ─────
# Uncomment this block when entering the final month before expiry.
#
# resource "google_cloud_scheduler_job" "daily_export" {
#   name             = "daily-full-export"
#   project          = var.project_id
#   region           = var.region
#   description      = "Daily export during final month before credit expiry"
#   schedule         = "0 3 * * *"
#   time_zone        = "UTC"
#   attempt_deadline = "1800s"
#
#   retry_config {
#     retry_count          = 2
#     min_backoff_duration = "30s"
#     max_backoff_duration = "300s"
#   }
#
#   http_target {
#     uri         = "${google_cloud_run_v2_service.app.uri}/api/admin/export"
#     http_method = "POST"
#
#     headers = {
#       "Content-Type" = "application/json"
#     }
#
#     oidc_token {
#       service_account_email = google_service_account.scheduler.email
#       audience              = google_cloud_run_v2_service.app.uri
#     }
#   }
#
#   depends_on = [google_project_service.apis]
# }
