# ─────────────────────────────────────────────────────────────
# VPC & Networking
# ─────────────────────────────────────────────────────────────

# VPC Connector for Cloud Run → Memorystore Redis
resource "google_vpc_access_connector" "connector" {
  provider      = google-beta
  name          = "${var.service_name}-vpc"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 10

  depends_on = [google_project_service.apis]
}
