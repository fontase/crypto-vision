# Deployment Guide

> How to deploy Crypto Vision to various environments.

## Table of Contents

1. [Quick Start (Local)](#quick-start-local)
2. [Docker Compose](#docker-compose)
3. [Google Cloud Run](#google-cloud-run)
4. [Kubernetes](#kubernetes)
5. [Self-Hosted (VPS)](#self-hosted-vps)
6. [Environment Variables](#environment-variables)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Monitoring & Health Checks](#monitoring--health-checks)
9. [Scaling](#scaling)

---

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start development server (hot reload)
npm run dev

# Or build and run production
npm run build
npm start
```

Server starts on `http://localhost:8080`.

---

## Docker Compose

The simplest production-ready deployment. No cloud dependencies.

### Full Stack (API + Redis + PostgreSQL)

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f api

# Stop
docker compose down
```

**Services:**

| Service | Image | Port | Resources |
|---------|-------|------|-----------|
| `api` | Custom (Dockerfile) | 8080 | 2Gi RAM, 4 CPU |
| `redis` | redis:7-alpine | 6379 | 256MB maxmemory, LRU eviction, AOF |
| `postgres` | postgres:16-alpine | 5432 | Default |

### With Ingestion Workers

```bash
# Start full stack + ingestion pipeline
docker compose -f docker-compose.yml -f docker-compose.ingest.yml up -d
```

Adds:
- Pub/Sub emulator
- 8 ingestion workers (market, defi, news, dex, derivatives, onchain, governance, macro)
- BigQuery emulator

### Container Details

The `Dockerfile` uses a 3-stage build:

```dockerfile
# Stage 1: Dependencies (cached layer)
FROM node:22-alpine AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Build (TypeScript compilation)
FROM node:22-alpine AS build
COPY . .
RUN npm run build

# Stage 3: Production (minimal image)
FROM node:22-alpine AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s CMD wget -qO- http://localhost:8080/health
CMD ["node", "dist/src/index.js"]
```

---

## Google Cloud Run

### Prerequisites

- GCP project with billing enabled
- `gcloud` CLI authenticated
- Artifact Registry repository created

### Using Cloud Build (Recommended)

```bash
# Submit build (uses cloudbuild.yaml)
gcloud builds submit --config=cloudbuild.yaml

# This automatically:
# 1. Type-checks
# 2. Lints
# 3. Runs tests
# 4. Builds container
# 5. Pushes to Artifact Registry
# 6. Deploys canary (5% traffic)
# 7. Health checks
# 8. Promotes to 100%
```

### Manual Deploy

```bash
# Build and push
docker build -t gcr.io/$PROJECT_ID/crypto-vision .
docker push gcr.io/$PROJECT_ID/crypto-vision

# Deploy to Cloud Run
gcloud run deploy crypto-vision \
  --image gcr.io/$PROJECT_ID/crypto-vision \
  --region us-central1 \
  --memory 2Gi \
  --cpu 4 \
  --min-instances 2 \
  --max-instances 500 \
  --port 8080 \
  --set-secrets="REDIS_URL=redis-url:latest,GROQ_API_KEY=groq-key:latest" \
  --allow-unauthenticated
```

### Using Terraform

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars

terraform init
terraform plan
terraform apply
```

Terraform manages:
- Cloud Run service
- Redis (Memorystore)
- Secret Manager secrets
- Cloud Scheduler jobs
- IAM roles
- Pub/Sub topics
- BigQuery datasets
- Monitoring alerts
- VPC networking

### Deploy Workers

```bash
gcloud builds submit --config=cloudbuild-workers.yaml
```

Deploys 8 Cloud Run Jobs for data ingestion + 1 backfill job.

### Infrastructure Teardown

```bash
cd infra
./teardown.sh
# Or: cd terraform && terraform destroy
```

---

## Kubernetes

Portable Kubernetes manifests in `infra/k8s/`.

### Deploy to Any Cluster

```bash
# Create namespace
kubectl apply -f infra/k8s/namespace.yaml

# Create secrets (from template)
cp infra/k8s/secrets-template.yaml infra/k8s/secrets.yaml
# Edit secrets.yaml with base64-encoded values
kubectl apply -f infra/k8s/secrets.yaml

# Deploy all resources
kubectl apply -f infra/k8s/

# Verify
kubectl get pods -n crypto-vision
kubectl get svc -n crypto-vision
```

### Resources

| Manifest | Resource | Description |
|----------|----------|-------------|
| `deployment.yaml` | Deployment | API server (2 replicas, 2Gi/4CPU) |
| `service.yaml` | Service | ClusterIP service on port 8080 |
| `hpa.yaml` | HPA | Auto-scale 2–50 pods on CPU/memory |
| `redis.yaml` | StatefulSet | Redis 7 with persistent volume |
| `cronjobs.yaml` | CronJob | 7 scheduled data refresh jobs |
| `network-policies.yaml` | NetworkPolicy | Pod-to-pod traffic rules |
| `pdb.yaml` | PDB | Max 1 unavailable during rollout |
| `inference-deployment.yaml` | Deployment | Model inference server |
| `training-job.yaml` | Job | GPU training job (GKE GPU node pool) |

### Tested Platforms

| Platform | Status |
|----------|--------|
| GKE (Google) | Production |
| EKS (AWS) | Compatible |
| AKS (Azure) | Compatible |
| k3s / k3d | Compatible (lightweight) |
| minikube | Development |

---

## Self-Hosted (VPS)

Minimal deployment on a single VPS (2+ CPU, 4+ GB RAM).

### Using Docker Compose

```bash
# On the VPS
git clone https://github.com/nirholas/crypto-vision.git
cd crypto-vision
cp .env.example .env
# Edit .env

docker compose up -d
```

### Using systemd

```bash
# Build
npm install && npm run build

# Create systemd service
sudo cat > /etc/systemd/system/crypto-vision.service << EOF
[Unit]
Description=Crypto Vision API
After=network.target redis.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/crypto-vision
EnvironmentFile=/opt/crypto-vision/.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable crypto-vision
sudo systemctl start crypto-vision
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name cryptocurrency.cv;

    ssl_certificate /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Environment Variables

See the root [README.md](../README.md) for the complete environment variable reference.

### Required for Production

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` |
| `PORT` | HTTP port (default: 8080) |
| `REDIS_URL` | Redis connection string |
| `CORS_ORIGINS` | Comma-separated allowed origins |

### Recommended

| Variable | Description |
|----------|-------------|
| `COINGECKO_API_KEY` | Higher rate limits for market data |
| `GROQ_API_KEY` | Fastest LLM provider for AI endpoints |
| `LOG_LEVEL` | Set to `warn` or `error` in production |

---

## CI/CD Pipeline

### Cloud Build (`cloudbuild.yaml`)

10-step pipeline:

```
1. npm ci                     # Install dependencies
2. npm run typecheck          # TypeScript strict check    ─┐
3. npm run lint               # ESLint                     ├─ Parallel
4. npm test                   # Vitest                     ─┘
5. docker build               # Build container image
6. docker push                # Push to Artifact Registry
7. gcloud run deploy (canary) # Deploy with 5% traffic
8. health check               # Verify /health endpoint
9. gcloud run update-traffic  # Promote to 100%
10. cleanup                   # Remove old revisions
```

### Worker Pipeline (`cloudbuild-workers.yaml`)

Builds worker image and deploys 8 Cloud Run Jobs + 1 backfill job.

---

## Monitoring & Health Checks

### Health Endpoint

`GET /health` returns:

```json
{
  "status": "healthy",
  "uptime": 86400,
  "version": "0.1.0",
  "cache": { "type": "redis", "connected": true },
  "sources": {
    "coingecko": "healthy",
    "defillama": "healthy",
    "mempool": "degraded"
  }
}
```

Status values:
- `healthy` — all systems operational
- `degraded` — some sources unavailable (stale cache being served)
- `unhealthy` — critical failure

### Prometheus Metrics

`GET /metrics` exposes:
- `http_requests_total` — request count by method, path, status
- `http_request_duration_seconds` — latency histogram
- `http_errors_total` — error count by type
- `cache_hits_total` / `cache_misses_total` — cache performance
- `upstream_requests_total` — source adapter call counts
- `circuit_breaker_state` — circuit breaker status per source

### Readiness Probe

`GET /api/ready` — returns 200 when the API is ready to serve traffic.

---

## Scaling

### Horizontal Scaling

| Platform | Mechanism | Config |
|----------|-----------|--------|
| Cloud Run | Request-based autoscaling | 2–500 instances |
| Kubernetes | HPA on CPU/memory | 2–50 pods |
| Docker Compose | Manual `--scale` | `docker compose up --scale api=4` |

### Vertical Scaling

| Component | Recommended | Maximum |
|-----------|-------------|---------|
| API Server | 2Gi RAM, 4 CPU | 4Gi RAM, 8 CPU |
| Redis | 256MB | 1Gi |
| PostgreSQL | 1Gi | 4Gi |

### Performance Tuning

- **WebSocket throttling** — 5 Hz broadcast batching (see [PERFORMANCE.md](PERFORMANCE.md))
- **Cache warming** — 7 Cloud Scheduler jobs pre-warm popular data
- **Connection pooling** — Redis and PostgreSQL connections are pooled
- **Response compression** — gzip/brotli on all responses >1KB
- **ETag caching** — conditional GET reduces bandwidth

See [PERFORMANCE.md](PERFORMANCE.md) for detailed performance optimization guidance.
