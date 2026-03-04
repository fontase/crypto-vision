# Developer Workflow

This document provides practical workflows for developing across the `crypto-vision` repository.

## 1) Prerequisites

- Node.js 22+ for root service development
- npm
- Docker (optional, for containerized runs)
- API keys in `.env` when using upstream providers and AI endpoints

## 2) Root service workflows

From repository root:

```bash
npm install
npm run dev
```

Common commands:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

## 3) App workflows

Each app is independently managed.

### `apps/dashboard`

```bash
cd apps/dashboard
npm install
npm run dev
npm run test:run
npm run build
```

### `apps/news`

```bash
cd apps/news
npm install
npm run dev
npm run test:run
npm run build
```

### `apps/video`

```bash
cd apps/video
npm install
npm run studio
# or
npm run render
```

## 4) Package workflows

Use package-local scripts in each folder under `packages/*`.

General pattern:

```bash
cd packages/<package-name>
npm install
npm run build
npm test
```

Start from each package README for package-specific setup, env, and runtime assumptions.

## 5) Infrastructure workflows

Use infrastructure scripts and docs from `infra/`:

```bash
cd infra
./setup.sh
# ... deploy / verify ...
./teardown.sh
```

Read:

- `infra/README.md`

## 6) Data and model workflows (root scripts)

Root includes operational scripts for export/training pipelines:

```bash
npm run export
npm run export:dry-run
npm run export:download
npm run export:import-pg

npm run training:generate
npm run training:validate
npm run training:prepare
npm run training:eval
```

## 7) Validation workflow before pushing

Recommended pre-push checklist:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. Run package/app checks for areas touched
5. Confirm `git status` is clean except intended files

## 8) Secret hygiene and push protection

If push protection blocks a push:

1. Identify offending commit and path from the GitHub error output.
2. Remove/rewrite secret-bearing commits from history.
3. Ensure generated caches (for example `.next/`) are ignored.
4. Push cleaned history.

Never assume revoking a key alone is sufficient for repository rule checks—Git history still needs to be clean.

## 9) Where to look for more docs

- Repository map: `docs/REPOSITORY_GUIDE.md`
- Root API docs: `README.md`
- Infra docs: `infra/README.md`
- App/package docs: `apps/*/README.md`, `packages/*/README.md`
