---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-04-11
---

# SOPHIA

SOPHIA is the showcase and reference application for the Restormel platform.

This repository combines the live SOPHIA product implementation with the Restormel platform narrative. **Only a small set of documentation is published in the clone**; deeper runbooks, archive, and platform packs stay local or in private storage.

## Project identity

`Restormel` is the platform and product family.

`SOPHIA` is the showcase/reference app that proves the platform in a real product: graph-grounded reasoning, verification, explainability, BYOK, billing, API surfaces, and philosophy learning all meet here first.

## Start here

| Area | Why it matters | Start here |
| --- | --- | --- |
| Documentation hub | Entry points for the curated public docs. | [Documentation Index](docs/README.md) |
| SOPHIA docs | Showcase app identity, architecture, roadmap, and current state. | [SOPHIA Documentation](docs/sophia/README.md) |
| Restormel docs | High-level platform framing (full planning pack not shipped here). | [Restormel Documentation](docs/restormel/README.md) |
| Ingestion workers | Credits, durable jobs, Neon egress notes for operators. | [Ingestion credits and workers](docs/operations/ingestion-credits-and-workers.md) |

## Documentation map

| Surface | Scope | Entry point |
| --- | --- | --- |
| SOPHIA | Architecture, roadmap, current state, Stoa game readme. | [docs/sophia/README.md](docs/sophia/README.md) |
| Restormel | Short public overview only. | [docs/restormel/README.md](docs/restormel/README.md) |
| Operations | Ingestion / worker operations slice shared publicly. | [docs/operations/ingestion-credits-and-workers.md](docs/operations/ingestion-credits-and-workers.md) |

## Current priorities snapshot

### SOPHIA

1. Keep SOPHIA documentation small, current, and aligned to the Restormel platform model.
2. Maintain SOPHIA as a convincing reference application across reasoning, API, and learning surfaces.
3. Continue domain growth with explicit status and promotion criteria rather than parallel undocumented expansions.
4. Extract reusable platform concerns into Restormel over time without letting SOPHIA documentation drift into a second competing platform plan.
5. Preserve historical material for traceability, but keep it out of the active instructional surface.

### Restormel

1. Contracts  
2. Graph-core + observability  
3. Restormel Graph MVP  
4. GraphRAG extraction  
5. Hosted GraphRAG  
6. Reasoning extraction  
7. BYOK/providers  
8. SOPHIA migration  
9. Public launch  
10. Marketplace readiness  

## Repository structure

- [`src/`](src) SvelteKit application, server logic, and UI surfaces.
- [`docs/`](docs) Curated public documentation (see [docs/README.md](docs/README.md)).
- [`scripts/`](scripts) Operational tooling, ingestion utilities, and automation.
- [`tests/`](tests) Playwright end-to-end coverage.
- [`data/`](data) Source data and ingestion inputs (see `.gitignore` for what is published).
- Production deploy: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (`gcloud run deploy`).

## Local development

```bash
pnpm install
pnpm python:venv
pnpm python:deps
cp .env.example .env
pnpm dev
```

Useful commands:

- `pnpm check`
- `pnpm test`
- `pnpm dev:prod-db`
- `pnpm python:venv`
- `pnpm python:deps`
- `pnpm python:check`

More pointers: [docs/README.md](docs/README.md).
