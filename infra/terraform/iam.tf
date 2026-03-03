# ─────────────────────────────────────────────────────────────
# IAM — Service Accounts
# ─────────────────────────────────────────────────────────────

# Cloud Run service account
resource "google_service_account" "cloud_run" {
  account_id   = "${var.service_name}-run"
  display_name = "Crypto Vision Cloud Run SA"
}

# Scheduler invoker service account
resource "google_service_account" "scheduler" {
  account_id   = "scheduler-invoker"
  display_name = "Cloud Scheduler Invoker"
}

# Let scheduler invoke Cloud Run
resource "google_project_iam_member" "scheduler_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}
