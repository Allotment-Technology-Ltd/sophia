# Restormel Migration Ledger

## Purpose

Track the incremental extraction of reusable Restormel platform modules from SOPHIA without destabilising the working app.

## Current status

- Workspace scaffolding exists for future shared packages.
- The live SOPHIA app still runs from the repository root.
- No runtime logic has been moved yet in this milestone.

## First extraction wave

### `@restormel/contracts`

Safest first move because the code is already mostly declarative.

Candidate files:

- `src/lib/types/api.ts`
- `src/lib/types/providers.ts`
- `src/lib/types/references.ts`
- `src/lib/types/verification.ts`
- `src/lib/types/enrichment.ts`
- `src/lib/types/constitution.ts`
- `src/lib/types/domains.ts`
- `src/lib/types/passes.ts`

### `@restormel/graph-core`

Best second move because Graph Kit already introduced package-like boundaries.

Candidate files:

- `src/lib/graph-kit/**`
- `src/lib/server/graphProjection.ts`
- `src/lib/utils/graphTrace.ts`
- `src/lib/utils/graphLayout.ts`

## Deferred extraction targets

### `@restormel/observability`

Depends on shared event contracts and some environment assumptions.

### `@restormel/graphrag-core`

Depends on provider contracts, retrieval storage, and graph projection contracts.

### `@restormel/reasoning-core`

Depends on prompts, provider calls, evaluation logic, and constitution/verification contracts.

### `@restormel/providers`

Depends on runtime configuration, secrets handling, BYOK storage, and app/server environment boundaries.

## App-local dependencies still blocking extraction

- Root-level SvelteKit config assumes the app lives at repository root.
- Server modules import across app-specific runtime, environment, and storage boundaries.
- Prompt files and orchestration code are still tightly coupled.
- Some Graph Kit rendering still depends on legacy SOPHIA canvas components.

## Risks to manage

- Contract extraction can create circular imports if server code keeps depending on app-local types.
- Provider extraction will be risky until environment and credential boundaries are explicit.
- App relocation should wait until shared packages are imported through stable public entrypoints.

## Immediate next step

Extract the first contract-only package with compatibility re-exports, add tests around those contracts, and then shift Graph Kit types and adapters onto package imports.
