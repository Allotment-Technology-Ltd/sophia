# Restormel Contracts Extraction Note

## Purpose

Establish `@restormel/contracts` as the shared ownership boundary for serialized and cross-package shapes before deeper platform extraction.

## Extracted into `@restormel/contracts`

- graph and SSE-facing contracts from `api`
- reasoning and verification contracts
- constitution contracts
- provider enums and parser helpers
- domain, pass, and reference contracts
- enrichment and ingestion metadata contracts
- learn-facing API contracts that are already serialized across boundaries

## Kept app-local for now

- server runtime logic
- storage adapters and DB row shaping
- UI-only view models
- provider clients and credential plumbing
- legacy `src/lib/server/types.ts` compatibility surface that still contains app-local leftovers

## Compatibility strategy

- `src/lib/types/*` now re-export from `@restormel/contracts/*`
- `src/lib/server/ingestion/contracts.ts` now re-exports from `@restormel/contracts/ingestion`
- high-traffic SOPHIA consumers now import `@restormel/contracts/*` directly

## Schema strategy

- package-level epoch: `RESTORMEL_CONTRACTS_SCHEMA_VERSION = 1`
- additive compatible changes stay within the same epoch
- breaking changes should bump the epoch and be recorded in migration docs

## Remaining gaps

- `GraphSnapshotMeta` and SSE unions are typed but not fully schema-validated yet
- some legacy server-only types still exist as compatibility leftovers
- contract fixtures are still light and should expand around graph snapshots and verification payloads

## Recommended next step

Move Graph Kit package imports fully onto `@restormel/contracts`, then begin extracting `@restormel/graph-core` using these contracts as the stable seam.
