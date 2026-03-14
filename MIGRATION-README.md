# Restormel Monorepo Foundation

This repository is now scaffolded to grow into a single Restormel monorepo while keeping SOPHIA as the working reference app.

## Current shape

- The live SOPHIA SvelteKit application still runs from the repository root.
- `apps/sophia` is a placeholder location for the future app package once relocation is safe.
- `packages/*` marks the first shared package boundaries to extract into incrementally.
- `infra` remains a separate package-like workspace for Pulumi infrastructure.

## Intended structure

- `apps/sophia`: future home of the SOPHIA app package
- `packages/contracts`: shared platform types and schemas
- `packages/graph-core`: graph view models, adapters, and shared graph logic
- `packages/observability`: shared telemetry, tracing, and logging helpers
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

Begin with `@restormel/contracts` and the extraction-ready Graph Kit data model before attempting app relocation or deeper runtime extraction.
