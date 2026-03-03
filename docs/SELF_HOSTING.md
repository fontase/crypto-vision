# Self-Hosting Crypto Vision After GCP Credits Expire

## Overview

This guide covers how to run the full Crypto Vision stack on any infrastructure
after GCP credits are exhausted. All artifacts — data, models, embeddings,
configurations — have been exported and are fully portable.

**Key principle**: every GCP service has an open-source or commodity equivalent.
The migration cost is operational, not technical.

---

## Table of Contents

1. [Exported Artifacts](#exported-artifacts)
2. [GCP Replacement Map](#gcp-replacement-map)
3. [BigQuery → PostgreSQL / DuckDB / ClickHouse](#bigquery-data-migration)
4. [Model Weights → Local GPU / Cloud GPU](#model-deployment)
5. [Embeddings → Self-Hosted Vector Database](#embeddings-migration)
6. [Infrastructure Replacement](#infrastructure-replacement)
7. [Minimal Self-Hosted Stack](#minimal-self-hosted-stack)
8. [Monthly Cost Estimates](#monthly-cost-estimates)
9. [Migration Timeline](#migration-timeline)
10. [Runbooks](#runbooks)

---

## Exported Artifacts

All artifacts are exported to `gs://{project}-exports/{export-id}/` with this
structure:

```
{export-id}/
├── manifest.json                    # Complete export manifest
├── bigquery/
│   ├── market_snapshots/            # Parquet + Snappy compressed
│   ├── ohlc_candles/
│   ├── defi_protocols/
│   ├── yield_pools/
│   ├── news_articles/
│   ├── fear_greed/
│   ├── dex_pairs/
│   ├── chain_tvl/
│   ├── exchange_snapshots/
│   ├── bitcoin_network/
│   ├── gas_prices/
│   ├── stablecoin_supply/
│   ├── funding_rounds/
│   ├── derivatives_snapshots/
│   ├── governance_proposals/
│   ├── whale_movements/
│   ├── agent_interactions/
│   ├── embeddings/                  # Parquet + JSONL (dual format)
│   ├── anomaly_events/
│   ├── search_analytics/
│   ├── training_pairs/
│   └── eval_results/
├── models/
│   ├── lora-adapters/               # LoRA weights (safetensors)
│   ├── quantized/                   # GPTQ 4-bit models
│   ├── training-data/               # JSONL training data
│   └── gemini-finetuned/            # Metadata only (weights in Vertex)
└── configs/
    └── project-snapshot.json        # All config files in one JSON
```

### Size Estimates

| Category | Estimated Size | Format |
|----------|---------------|--------|
| BigQuery tables (22) | 50–200 GB | Parquet (Snappy) |
| LoRA adapters (4–8 models) | 2–16 GB | safetensors |
| Quantized models (GPTQ 4-bit) | 5–20 GB each | safetensors |
| Training data | 1–5 GB | JSONL |
| Embedding vectors | 10–50 GB | Parquet + JSONL |
| Configs | < 10 MB | JSON |
| **Total** | **100–500 GB** | — |

---

## GCP Replacement Map

| GCP Service | Self-Hosted Replacement | Cloud Alternative |
|-------------|------------------------|-------------------|
| BigQuery | DuckDB / PostgreSQL / ClickHouse | Supabase / PlanetScale |
| Vertex AI (inference) | vLLM / TGI / Ollama | RunPod / Together.ai |
| Vertex AI (fine-tuning) | Axolotl + local GPU | Lambda Cloud |
| Cloud Storage (GCS) | MinIO / local filesystem | S3 / Backblaze B2 |
| Pub/Sub | Redis Streams / BullMQ | Upstash |
| Memorystore (Redis) | Redis 7 (docker) | Upstash / Redis Cloud |
| Cloud Run | Docker Compose / k3s | Fly.io / Railway |
| Cloud Scheduler | node-cron / system crontab | — |
| Cloud Logging | Pino → stdout / Loki | Datadog / Grafana Cloud |
| Secret Manager | .env files / Doppler | Infisical / 1Password |

---

## BigQuery Data Migration

All BigQuery tables are exported as **Parquet** files (Snappy compressed).
Parquet is columnar, compact, and universally supported.

### Option 1: DuckDB (Recommended for Dev / Small Deployments)

DuckDB is an in-process analytical database — zero infrastructure, reads Parquet
natively, and runs complex queries in milliseconds on reasonable data sizes.

```bash
# Install
brew install duckdb  # macOS
# or: apt install duckdb  # Linux

# Query directly from Parquet (no import needed!)
duckdb -c "
  SELECT symbol, price, volume_24h
  FROM read_parquet('exports/bigquery/market_snapshots/*.parquet')
  WHERE symbol = 'BTC'
  ORDER BY ingested_at DESC
  LIMIT 10;
"

# Create a persistent database
duckdb crypto.duckdb
```

```sql
-- Inside DuckDB: create tables from Parquet
CREATE TABLE market_snapshots AS
  SELECT * FROM read_parquet('exports/bigquery/market_snapshots/*.parquet');

CREATE TABLE ohlc_candles AS
  SELECT * FROM read_parquet('exports/bigquery/ohlc_candles/*.parquet');

-- Repeat for all 22 tables...
-- Or use a loop:
-- .read scripts/import-duckdb.sql
```

### Option 2: PostgreSQL

PostgreSQL is the recommended production database for most deployments.

```bash
# Run the automated import script
npx tsx scripts/import-to-postgres.ts \
  --dir ./exports/bigquery \
  --db postgres://user:pass@localhost:5432/crypto_vision

# Or import a single table
npx tsx scripts/import-to-postgres.ts \
  --dir ./exports/bigquery \
  --db postgres://localhost:5432/crypto_vision \
  --table market_snapshots
```

**Manual approach:**

```bash
# 1. Convert Parquet to CSV via DuckDB
duckdb -c "COPY (SELECT * FROM read_parquet('exports/bigquery/market_snapshots/*.parquet')) TO '/tmp/market_snapshots.csv' (HEADER, DELIMITER ',')"

# 2. Create table and import
psql postgres://localhost/crypto -c "
  CREATE TABLE market_snapshots (
    -- columns from Parquet schema
  );
  \COPY market_snapshots FROM '/tmp/market_snapshots.csv' WITH (FORMAT csv, HEADER true)
"
```

### Option 3: ClickHouse

ClickHouse is ideal for high-volume time-series analytics.

```sql
-- ClickHouse reads Parquet natively
CREATE TABLE market_snapshots ENGINE = MergeTree()
ORDER BY (symbol, ingested_at)
AS SELECT * FROM file('exports/bigquery/market_snapshots/*.parquet', Parquet);
```

---

## Model Deployment

### LoRA Adapters

LoRA adapters are exported as standard safetensors/PyTorch format, compatible
with any Hugging Face-compatible inference runtime.

**vLLM (Recommended — OpenAI-compatible API):**

```bash
pip install vllm

# Serve base model with LoRA adapter(s)
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Meta-Llama-3.1-8B-Instruct \
  --enable-lora \
  --lora-modules crypto-analyst=./exports/models/lora-adapters/llama-3.1-8b-crypto \
  --max-lora-rank 64 \
  --port 8000
```

**text-generation-inference (TGI):**

```bash
docker run --gpus all \
  -v ./exports/models:/models \
  ghcr.io/huggingface/text-generation-inference:latest \
  --model-id /models/lora-adapters/llama-3.1-8b-crypto \
  --port 8000
```

**Ollama (easiest for local dev):**

```bash
# Convert to GGUF first (if needed)
pip install llama-cpp-python
python -m llama_cpp.convert \
  --input ./exports/models/quantized/llama-3.1-8b-crypto-gptq \
  --output ./llama-3.1-8b-crypto.gguf

# Import into Ollama
ollama create crypto-analyst -f Modelfile
ollama run crypto-analyst
```

### Quantized Models (GPTQ)

```bash
# Serve directly with vLLM
python -m vllm.entrypoints.openai.api_server \
  --model ./exports/models/quantized/llama-3.1-8b-crypto-gptq \
  --quantization gptq \
  --gpu-memory-utilization 0.9 \
  --port 8000
```

### GPU Hosting Options

| Provider | GPU | 8B Model Cost | 70B Model Cost | Notes |
|----------|-----|--------------|----------------|-------|
| RunPod | A100 80GB | $1.64/hr | $3.28/hr (2×) | Serverless available |
| Vast.ai | A100 80GB | $1.10/hr | $2.20/hr (2×) | Spot pricing |
| Lambda Labs | A100 80GB | $1.25/hr | $2.50/hr (2×) | Reserved instances |
| Self-hosted | RTX 4090 24GB | $0/hr | N/A (70B doesn't fit) | $1,600 one-time |
| Together.ai | — | $0.20/M tokens | $0.90/M tokens | Managed API |
| Groq | LPU | $0.05/M tokens | $0.59/M tokens | Fastest inference |

---

## Embeddings Migration

Embeddings are exported in both Parquet and JSONL formats for maximum
compatibility.

### Qdrant (Recommended)

```bash
# Start Qdrant
docker run -p 6333:6333 -v qdrant_data:/qdrant/storage qdrant/qdrant:latest
```

```python
import json
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance

client = QdrantClient(url="http://localhost:6333")

# Create collection
client.create_collection(
    collection_name="crypto_embeddings",
    vectors_config=VectorParams(size=768, distance=Distance.COSINE),
)

# Import from JSONL
points = []
with open("exports/bigquery/embeddings/embeddings-*.jsonl") as f:
    for i, line in enumerate(f):
        row = json.loads(line)
        points.append(PointStruct(
            id=i,
            vector=row["embedding"],
            payload={
                "content": row["content"],
                "category": row["category"],
                "source": row["source"],
                "metadata": json.loads(row.get("metadata", "{}")),
            },
        ))
        if len(points) >= 1000:
            client.upsert("crypto_embeddings", points)
            points = []

if points:
    client.upsert("crypto_embeddings", points)
```

### pgvector (PostgreSQL)

```sql
CREATE EXTENSION vector;

CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  content TEXT,
  embedding vector(768),
  category TEXT,
  source TEXT,
  metadata JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### ChromaDB

```python
import chromadb
client = chromadb.PersistentClient(path="./chroma_data")
collection = client.create_collection("crypto_embeddings")
# Import from JSONL...
```

---

## Infrastructure Replacement

### Replace Pub/Sub with Redis Streams

```typescript
// Before (GCP Pub/Sub)
// const pubsub = new PubSub();
// await pubsub.topic('market-data').publishMessage({ json: data });

// After (Redis Streams via BullMQ)
import { Queue } from 'bullmq';
const queue = new Queue('market-data', { connection: { host: 'redis' } });
await queue.add('snapshot', data);
```

### Replace Cloud Scheduler with node-cron

```typescript
import cron from 'node-cron';

// Every 5 minutes: refresh market data
cron.schedule('*/5 * * * *', async () => {
  await fetch('http://localhost:3000/api/refresh/market');
});

// Every hour: refresh DeFi data
cron.schedule('0 * * * *', async () => {
  await fetch('http://localhost:3000/api/refresh/defi');
});
```

### Replace Cloud Run with Docker Compose

See the [Minimal Self-Hosted Stack](#minimal-self-hosted-stack) below.

---

## Minimal Self-Hosted Stack

```yaml
# docker-compose.self-hosted.yml
version: "3.9"

services:
  app:
    build: .
    ports:
      - "3000:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/crypto_vision
      - VLLM_BASE_URL=http://vllm:8000/v1
      - QDRANT_URL=http://qdrant:6333
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: crypto_vision
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
      interval: 15s
      timeout: 5s
      retries: 3

  # GPU inference (optional — requires NVIDIA GPU + nvidia-docker2)
  vllm:
    image: vllm/vllm-openai:latest
    runtime: nvidia
    ports:
      - "8000:8000"
    volumes:
      - ./exports/models:/models
    command: >
      --model /models/quantized/llama-3.1-8b-crypto-gptq
      --quantization gptq
      --gpu-memory-utilization 0.9
      --max-model-len 8192
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
    profiles:
      - gpu

volumes:
  redis_data:
  pgdata:
  qdrant_data:
```

**Start without GPU:**

```bash
docker compose -f docker-compose.self-hosted.yml up -d
```

**Start with GPU inference:**

```bash
docker compose -f docker-compose.self-hosted.yml --profile gpu up -d
```

---

## Monthly Cost Estimates

### Self-Hosted (VPS + GPU)

| Component | Provider | Monthly Cost |
|-----------|----------|-------------|
| App + Redis + DB | Hetzner CX41 (8 vCPU, 16 GB) | €15 (~$17) |
| Qdrant | Same server | $0 (embedded) |
| GPU (8B model) | Own RTX 4090 | $0 (electricity ~$15) |
| Storage (500 GB SSD) | Hetzner Volume | €10 (~$11) |
| Domain + CDN | Cloudflare | $0 (free tier) |
| **Total** | | **~$43/mo** |

### Cloud (Budget)

| Component | Provider | Monthly Cost |
|-----------|----------|-------------|
| App Server | Fly.io (2 vCPU, 4 GB) | $30/mo |
| Redis | Upstash (10K commands/day free) | $0 |
| Database | Supabase (free tier) | $0 |
| Vector DB | Qdrant Cloud (1 GB free) | $0 |
| GPU Inference | Together.ai / Groq (API) | ~$20/mo |
| **Total** | | **~$50/mo** |

### Cloud (Production)

| Component | Provider | Monthly Cost |
|-----------|----------|-------------|
| App Server | Fly.io (4 vCPU, 8 GB, 2 instances) | $120/mo |
| Redis | Upstash Pro | $15/mo |
| Database | Supabase Pro | $25/mo |
| Vector DB | Qdrant Cloud (10 GB) | $25/mo |
| GPU (8B model, 24/7) | RunPod Serverless | ~$100/mo |
| CDN | Cloudflare Pro | $20/mo |
| **Total** | | **~$305/mo** |

---

## Migration Timeline

### Week 1: Validate Exports

```bash
# 1. Download exports
./scripts/download-exports.sh ./exports

# 2. Verify Parquet integrity
duckdb -c "SELECT count(*) FROM read_parquet('exports/bigquery/market_snapshots/*.parquet')"

# 3. Verify all tables have data
for dir in exports/bigquery/*/; do
  table=$(basename "$dir")
  count=$(duckdb -c "SELECT count(*) FROM read_parquet('${dir}*.parquet')" -csv -noheader 2>/dev/null || echo "0")
  echo "${table}: ${count} rows"
done
```

### Week 2: Set Up Self-Hosted Infrastructure

```bash
# 1. Provision VPS (Hetzner / DigitalOcean / Linode)
# 2. Install Docker + Docker Compose
# 3. Clone repo and start stack
git clone https://github.com/nirholas/crypto-vision.git
cd crypto-vision
docker compose -f docker-compose.self-hosted.yml up -d

# 4. Import data
npx tsx scripts/import-to-postgres.ts \
  --dir ./exports/bigquery \
  --db postgres://postgres:postgres@localhost:5432/crypto_vision
```

### Week 3: Validate & Switchover

```bash
# 1. Run health checks
curl http://localhost:3000/health

# 2. Run API tests against self-hosted
API_BASE_URL=http://localhost:3000 npx vitest run --config vitest.e2e.config.ts

# 3. Update DNS (e.g., Cloudflare)
#    cryptocurrency.cv → new server IP

# 4. Decommission GCP (after 48h parallel running)
```

### Emergency Checklist (Day Before Expiry)

- [ ] Final export: `npx tsx scripts/export-all.ts`
- [ ] Download everything: `./scripts/download-exports.sh /mnt/backup`
- [ ] Verify download integrity (check manifest)
- [ ] Self-hosted stack running and healthy
- [ ] DNS pointing to new infrastructure
- [ ] SSL certificates provisioned (Cloudflare / Let's Encrypt)
- [ ] Monitoring configured (uptime checks)
- [ ] Backup copy on external drive or second cloud

---

## Runbooks

### Runbook: Full Re-Import from Scratch

```bash
# 1. Start fresh PostgreSQL
docker compose -f docker-compose.self-hosted.yml up -d db

# 2. Import all tables
npx tsx scripts/import-to-postgres.ts --dir ./exports/bigquery --db postgres://postgres:postgres@localhost:5432/crypto_vision --skip-errors

# 3. Import embeddings into Qdrant
docker compose -f docker-compose.self-hosted.yml up -d qdrant
python scripts/import-qdrant.py --input ./exports/bigquery/embeddings/

# 4. Start app
docker compose -f docker-compose.self-hosted.yml up -d app
```

### Runbook: Switch Inference Provider

To switch from self-hosted vLLM to a cloud API:

```bash
# Update environment variable
export VLLM_BASE_URL=https://api.together.xyz/v1
export VLLM_API_KEY=your-key

# Restart app
docker compose -f docker-compose.self-hosted.yml restart app
```

The app's AI routes use OpenAI-compatible endpoints, so any provider with
the `/v1/chat/completions` interface works out of the box:
- Together.ai
- Groq
- Fireworks
- vLLM (self-hosted)
- Ollama (with OpenAI compatibility layer)

### Runbook: Incremental Data Updates

After migrating, continue ingesting data using the existing API routes:

```bash
# Trigger market data refresh
curl -X POST http://localhost:3000/api/refresh/market -H "X-API-Key: your-key"

# Set up cron for periodic refreshes
crontab -e
# */5 * * * * curl -s http://localhost:3000/api/refresh/market > /dev/null
# 0 * * * * curl -s http://localhost:3000/api/refresh/defi > /dev/null
```

---

## FAQ

**Q: Can I export Gemini fine-tuned model weights?**
A: Gemini models trained via Vertex AI cannot have weights exported — they run
only on Google infrastructure. However, the training data is fully exported, so
you can re-fine-tune the same dataset on an open-source base model (Llama 3.1,
Mistral, Qwen) using Axolotl or similar tools. The LoRA adapters trained on
open-source models *are* fully portable.

**Q: What about the Pub/Sub dead letter queue?**
A: Dead letter messages are archived to GCS during normal operation. They're
included in the model weights export path under `training-data/`.

**Q: How long will the exports take?**
A: Depends on data volume. Estimate:
- BigQuery (200 GB): 30–60 minutes
- Model weights (50 GB): 15–30 minutes
- Total: 1–2 hours

**Q: What's the egress cost?**
A: GCS egress is $0.12/GB. For 500 GB total: ~$60. Well within the $5K budget.
