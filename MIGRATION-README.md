# Restormel Monorepo Foundation

This repository is now scaffolded to grow into a single Restormel monorepo while keeping SOPHIA as the working reference app.

## Current shape

- The live SOPHIA SvelteKit application still runs from the repository root.
- `apps/sophia` is a placeholder location for the future app package once relocation is safe.
- `packages/*` marks the first shared package boundaries to extract into incrementally.
- Production GCP is operated via **GitHub Actions** and **`gcloud`**; see `docs/operations/gcp-infrastructure.md`.

## Intended structure

- `apps/sophia`: future home of the SOPHIA app package
- Published **`@restormel/contracts`**, **`@restormel/observability`**, **`@restormel/graph-reasoning-extensions`** (npm): shared types, trace helpers, compare/projection/evaluation
- Published **`@restormel/graph-core`** + **`@restormel/ui-graph-svelte`** (npm): Contract v0 DTOs, layout/trace/workspace, and SVG canvas
- `packages/graphrag-core`: retrieval and graph-RAG composition logic
- `packages/reasoning-core`: reasoning, validation, and synthesis orchestration
- `packages/providers`: provider integrations and BYOK-facing abstractions

## What changed in this milestone

- Added npm and pnpm workspace definitions.
- Added placeholder workspace folders for the first Restormel package seams.
- Added a migration ledger documenting what should move first and what still depends on app-local code.

## What did not change

- No runtime code has been moved yet.
- SOPHIA still builds and runs from the repository root.
- Existing root scripts remain the primary developer entrypoints for now.

## Next step

Phase 1 platform packages are consumed from **npm**; see [`docs/restormel/PHASE1-EXTRACTION-STATUS.md`](docs/restormel/PHASE1-EXTRACTION-STATUS.md). Further extraction (e.g. `packages/aaif` → npm, app relocation to `apps/sophia`) can proceed when ready.
