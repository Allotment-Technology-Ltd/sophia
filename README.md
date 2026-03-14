---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

# SOPHIA

SOPHIA is the showcase and reference application for the Restormel platform.

This repository combines the live SOPHIA product implementation with the active Restormel platform planning pack. The public-facing documentation surface is intentionally split so visitors can quickly distinguish:
- what SOPHIA is now
- how it relates to Restormel
- which docs are active
- which materials are supporting reference
- which documents are archived history

## Project identity

`Restormel` is the platform and product family.

`SOPHIA` is the showcase/reference app that proves the platform in a real product: graph-grounded reasoning, verification, explainability, BYOK, billing, API surfaces, and philosophy learning all meet here first.

The current repo purpose is therefore twofold:
- operate SOPHIA as a real application
- document and steer the extraction of reusable Restormel platform capabilities from the same codebase

## Start here

<!-- GENERATED:key-links:start -->
| Area | Why it matters | Start here |
| --- | --- | --- |
| SOPHIA docs | Current showcase app docs, architecture, roadmap, and domain status. | [SOPHIA Documentation](docs/sophia/README.md) |
| Restormel docs | Platform strategy, architecture, delivery planning, and reference automation. | [Restormel Documentation](docs/restormel/README.md) |
| Documentation hub | Cross-repo docs navigation, active/reference/archive split, and entry points. | [Documentation Index](docs/README.md) |
| Archive | Historical plans and superseded materials kept for traceability. | [Documentation Archive](docs/archive/README.md) |
<!-- GENERATED:key-links:end -->

## Documentation map

Use the active docs surfaces below before reaching for older repo notes or archived plans.

<!-- GENERATED:repo-doc-map:start -->
| Status | Surface | Docs | Scope | Entry point |
| --- | --- | --- | --- | --- |
| Active | SOPHIA | 8 | Showcase app identity, architecture, roadmap, domains, and changelog. | [SOPHIA Documentation](docs/sophia/README.md) |
| Active | Restormel | 24 | Platform strategy, modularisation, delivery controls, and product planning. | [Restormel Documentation](docs/restormel/README.md) |
| Reference | Reference docs | 19 | Supporting API, architecture, operations, product, and learning references. | [Reference Documentation](docs/reference/README.md) |
| Archived | Archive | 39 | Historical strategy, architecture, delivery, product, and experiment material. | [Documentation Archive](docs/archive/README.md) |
<!-- GENERATED:repo-doc-map:end -->

## Current priorities snapshot

These lists are pulled from the current active SOPHIA and Restormel docs so the landing page stays aligned with the maintained source-of-truth set.

<!-- GENERATED:current-priorities:start -->
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
<!-- GENERATED:current-priorities:end -->

## Repository structure

The codebase still contains both product implementation and platform extraction work.

<!-- GENERATED:repo-structure:start -->
- [`src/`](src) SvelteKit application, server logic, and UI surfaces.
- [`docs/`](docs) Public, reference, and archived documentation surfaces.
- [`scripts/`](scripts) Operational tooling, ingestion utilities, and docs automation.
- [`tests/`](tests) Playwright end-to-end coverage.
- [`infra/`](infra) Infrastructure configuration and deployment assets.
- [`data/`](data) Source data and ingestion inputs.
<!-- GENERATED:repo-structure:end -->

## Active vs archived

Use `docs/sophia/` for the current SOPHIA product narrative and `docs/restormel/` for platform strategy, architecture, roadmap, and delivery. Use `docs/reference/` for supporting operational or API detail. Use `docs/archive/` only for provenance, retrospectives, and superseded plans.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Useful commands:
- `pnpm check`
- `pnpm test`
- `pnpm dev:prod-db`

For operational runbooks, API reference, and deeper implementation notes, use [docs/README.md](docs/README.md).
