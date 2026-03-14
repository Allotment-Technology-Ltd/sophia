# @restormel/contracts

`@restormel/contracts` is the shared ownership boundary for shapes that cross app, API, storage, trace, or package boundaries.

## What belongs here

- request and response DTOs
- graph, trace, reasoning, retrieval, and provider-facing types
- zod schemas for serialized or validated shapes
- ingestion metadata contracts reused outside a single server implementation

## What does not belong here

- server-only runtime logic
- storage adapters
- provider clients
- UI-specific view models
- app-local stores and component state

## Versioning

- `RESTORMEL_CONTRACTS_SCHEMA_VERSION` is the package-level schema epoch
- additive changes should preserve compatibility within the same epoch
- breaking contract changes should bump the schema epoch and be called out in migration docs

## Initial extraction scope

- `api`, `constitution`, `domains`, `enrichment`, `ingestion`, `learn`, `passes`, `providers`, `references`, `trace`, and `verification`
- SOPHIA app-local shims in `src/lib/types/*` and `src/lib/server/ingestion/contracts.ts` now re-export from this package during migration
