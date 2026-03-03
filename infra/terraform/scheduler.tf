# ─────────────────────────────────────────────────────────────
# Cloud Scheduler Jobs — Periodic Data Refresh
# ─────────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "refresh" {
  for_each = { for job in var.scheduler_jobs : job.name => job }

  name        = each.value.name
  description = each.value.desc
  schedule    = each.value.schedule
  time_zone   = "UTC"
  region      = var.region

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
  }

  http_target {
    uri         = "${google_cloud_run_v2_service.app.uri}${each.value.path}"
    http_method = "GET"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.app.uri
    }
  }

  depends_on = [google_project_service.apis]
}
