# Crypto Vision Repository Guide

This guide documents the full `crypto-vision` repository structure and how the major projects relate to each other.

## 1) What this repository contains

`crypto-vision` is a multi-project TypeScript monorepo-style workspace containing:

- A root API service (Hono + TypeScript) for crypto intelligence and AI endpoints
- Multiple app surfaces under `apps/` (`dashboard`, `news`, `video`)
- Reusable and standalone packages under `packages/`
- Infrastructure-as-code and deployment resources under `infra/`
- Prompt and agent assets under `prompts/` and `agents/`
- Multi-layer test suites under `tests/`

## 2) High-level repository map

```text
crypto-vision/
├── src/                    # Root API service implementation
├── tests/                  # Root service tests (e2e, integration, fuzz, load)
├── apps/
│   ├── dashboard/          # Next.js dashboard product
│   ├── news/               # Next.js news-focused product
│   └── video/              # Remotion video project
├── packages/
│   ├── agent-runtime/      # Agent runtime package
│   ├── binance-mcp/        # Binance MCP server package
│   ├── bnbchain-mcp/       # BNB Chain MCP package
│   ├── market-data/        # Market data package
│   ├── mcp-server/         # Main MCP server package
│   ├── pump-agent-swarm/   # Pump.fun swarm orchestration package
│   ├── sweep/              # Sweep protocol/contracts + frontend
│   └── ucai/               # Universal Contract AI Interface package
├── infra/                  # Deployment and cloud infra resources
├── agents/                 # Agent catalog, templates, docs, locales, prompts
├── prompts/                # System prompts + swarm prompt packs
├── docs/                   # Root operational and architecture docs
└── scripts/                # Data export/import and helper scripts
```

## 3) Root API service (`src/`)

The root service is the primary backend API and includes:

- Market endpoints
- DeFi endpoints
- News endpoints
- On-chain endpoints
- AI endpoints with multi-provider fallback
- Worker/sources pipelines for upstream ingestion

Primary entrypoint:

- `src/index.ts`

Primary API contract:

- `openapi.yaml`

Related documentation:

- Root README: `README.md`
- Performance guide: `docs/PERFORMANCE.md`
- Self-hosting guide: `docs/SELF_HOSTING.md`

## 4) Applications (`apps/`)

### `apps/dashboard`

A Next.js dashboard application with extensive UI, SDK, integrations, and tooling assets.

Start here:

- `apps/dashboard/README.md`
- `apps/dashboard/docs/README.md`

### `apps/news`

A Next.js news-first application/API distribution with localization and extensive docs/examples.

Start here:

- `apps/news/README.md`
- `apps/news/docs/README.md`

### `apps/video`

Remotion project for rendering crypto/agent-themed videos.

Start here:

- `apps/video/package.json` scripts (`studio`, `render`, `render:gif`)

## 5) Packages (`packages/`)

Top-level package index:

- `packages/agent-runtime/README.md`
- `packages/binance-mcp/README.md`
- `packages/bnbchain-mcp/README.md`
- `packages/market-data/README.md`
- `packages/mcp-server/README.md` (and module READMEs)
- `packages/pump-agent-swarm/README.md`
- `packages/sweep/README.md`
- `packages/ucai/README.md`

These packages are intentionally heterogeneous: some are libraries, some are servers, and some are full product/workspace modules.

## 6) Infrastructure (`infra/`)

Infrastructure resources include:

- Terraform resources (`infra/terraform/`)
- Kubernetes manifests (`infra/k8s/`)
- BigQuery, Pub/Sub, Scheduler assets
- Lifecycle scripts (`infra/setup.sh`, `infra/teardown.sh`)

Start here:

- `infra/README.md`

## 7) Prompt + agent assets

### `agents/`

Contains:

- Agent templates and manifest
- Agent documentation (`agents/docs/`)
- Localization assets (`agents/locales/`)
- Prompt bundles (`agents/prompts/`)
- Schema and scripts for generation and splitting

### `prompts/`

Contains:

- End-to-end implementation prompts (`01...12`)
- Swarm-focused prompt series (`prompts/swarm/`)

## 8) Testing layout

Root test coverage is organized by testing mode:

- `tests/routes/` for route-level tests
- `tests/integration/` for integration flow coverage
- `tests/e2e/` for end-to-end behavior
- `tests/fuzz/` and `tests/load/` for robustness/performance validation
- `tests/benchmarks/` for benchmark scenarios

## 9) Build and run entrypoints

Root project scripts are defined in `package.json`:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`

Additional domain scripts include training and data export/import flows.

See also: `docs/DEVELOPER_WORKFLOW.md`.

## 10) Security and generated artifacts policy

Do not commit generated build caches or local runtime artifacts.

At minimum, keep these ignored:

- `.next/`
- `.turbo/`
- build output folders (`dist/`, local `out/` where applicable)
- local env files (`.env*`)

If a secret is accidentally committed:

1. Revoke/rotate credential immediately.
2. Rewrite history to remove the secret-bearing commit(s).
3. Force-push cleaned history only after validating no secret blobs remain.
4. Re-run push and confirm repository rule checks pass.

## 11) Suggested onboarding path

For new contributors:

1. Read `README.md` for root API setup.
2. Read this document to understand project boundaries.
3. Read the specific app/package README for your target area.
4. Run local checks (`lint`, `typecheck`, `test`) before opening a PR.
