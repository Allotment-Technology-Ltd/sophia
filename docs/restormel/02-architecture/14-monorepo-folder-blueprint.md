---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Build Pack 01: Monorepo Folder Blueprint

## Purpose

This document defines the target monorepo structure for the Restormel platform and the migration path from the current SOPHIA codebase. The goal is to create a package architecture that supports:

- reusable developer products under the `@restormel/*` namespace
- SOPHIA as the flagship reference application
- shared contracts across products and hosted APIs
- incremental extraction from the existing repository without a risky rewrite

## Recommended Repository Model

Use a **single monorepo** first.

This is the safest and fastest path because the current codebase has strong coupling across:

- runtime types
- provider configuration
- graph projection
- reasoning orchestration
- retrieval pipelines
- streaming event handling
- UI stores and components

A multi-repo split can happen later if package maturity and team structure justify it.

## Target Repository Name

`restormel-platform`

This becomes the platform workspace that contains:

- product apps
- public docs
- hosted API service
- shared packages
- infrastructure code
- migration scripts

## Top-Level Structure

```text
restormel-platform/
  apps/
  packages/
  services/
  docs/
  infra/
  scripts/
  tooling/
  tests/
  .changeset/
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  eslint.config.js
```

## Folder Responsibilities

### `apps/`
User-facing applications and product surfaces.

```text
apps/
  sophia/
  restormel-web/
  restormel-docs/
  restormel-console/
```

#### `apps/sophia/`
The reference application and public demonstration of the platform.

Owns:
- SOPHIA consumer UI
- SOPHIA-specific routes and pedagogy flows
- SOPHIA billing and commercial packaging
- branded learning and reference experiences

Consumes:
- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/graphrag-core`
- `@restormel/reasoning-core`
- `@restormel/providers`
- `@restormel/observability`
- `@restormel/ui`

#### `apps/restormel-web/`
The public `restormel.dev` marketing and product entry site.

Owns:
- product homepage
- product overview pages
- playground entry points
- package landing pages
- docs hand-off
- pricing and product comparison pages

#### `apps/restormel-docs/`
Developer documentation site.

Owns:
- quickstarts
- product docs
- SDK docs
- API reference
- schema reference
- deployment and marketplace docs

#### `apps/restormel-console/`
Authenticated developer control plane.

Owns:
- projects
- API keys
- provider settings
- usage and billing
- playground saves
- trace history
- import/export tools

### `services/`
Backend services that power hosted platform products.

```text
services/
  api-gateway/
  reasoning-api/
  graphrag-api/
  ingestion-worker/
  webhooks/
```

#### `services/api-gateway/`
Unified public API surface and auth boundary.

#### `services/reasoning-api/`
Hosted structured reasoning product.

#### `services/graphrag-api/`
Hosted GraphRAG product.

#### `services/ingestion-worker/`
Document ingestion, extraction, enrichment, and graph population jobs.

#### `services/webhooks/`
Provider, billing, and marketplace webhook handlers.

### `packages/`
Reusable platform modules.

```text
packages/
  contracts/
  graph-core/
  graphrag-core/
  reasoning-core/
  providers/
  observability/
  sdk/
  ui/
  ingestion-core/
  cli/
```

#### `packages/contracts/`
Stable shared schemas and types.

Exports:
- graph contract
- reasoning event contract
- retrieval trace contract
- provider config contract
- source, claim, relation schemas

#### `packages/graph-core/`
Graph construction, projection, transforms, filtering, and graph stats.

#### `packages/graphrag-core/`
Retrieval logic, hybrid candidate generation, seed set selection, graph expansion, context-pack shaping.

#### `packages/reasoning-core/`
Three-pass reasoning runtime, pass orchestration, structured pass outputs, evaluation hooks.

#### `packages/providers/`
Provider registry, model routing, BYOK validation, credential handling.

#### `packages/observability/`
Trace handling, snapshot shaping, replay formatting, run diagnostics.

#### `packages/sdk/`
Public client SDKs for hosted and local platform consumption.

#### `packages/ui/`
Design-system primitives and platform UI components.

#### `packages/ingestion-core/`
Claim extraction, passage segmentation, relation extraction, ingestion contracts, enrichment helpers.

#### `packages/cli/`
Developer CLI for local workflows.

### `docs/`
Planning, product architecture, ADRs, and internal specifications.

```text
docs/
  strategy/
  architecture/
  adrs/
  product/
  operations/
```

### `infra/`
Infrastructure-as-code and deploy definitions.

```text
infra/
  pulumi/
  marketplace/
  environments/
```

### `scripts/`
Migration and operational scripts.

This is where the current SOPHIA scripts can live during transition.

### `tooling/`
Shared tooling config.

Examples:
- lint rules
- release tooling
- code generators
- test utilities

### `tests/`
Cross-package integration and smoke tests.

## Package Naming

Public package namespace should use the Restormel brand.

- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/graphrag-core`
- `@restormel/reasoning-core`
- `@restormel/providers`
- `@restormel/observability`
- `@restormel/sdk`
- `@restormel/ui`

Internal-only or not-yet-public packages can still live under the same namespace or remain private.

## Recommended Tooling

- **pnpm workspaces** for package management
- **Turborepo** for build and task orchestration
- **TypeScript project references** for shared package builds
- **Changesets** for package versioning and releases
- **Vitest** for package tests
- **Playwright** for app-level smoke and critical path tests

## Migration Principles

### Principle 1: Extract by boundary, not by ambition
Move code only once a clean responsibility is defined.

### Principle 2: Stabilize contracts first
The shared schemas must be frozen before deeper package extraction.

### Principle 3: Keep SOPHIA working throughout
SOPHIA is still the demo and should not be destabilized by the platform work.

### Principle 4: Prefer adapters over rewrites
Wrap existing modules where necessary before fully refactoring them.

## Initial App Ownership Model

### First public app to launch
`apps/restormel-web`

### First internal package to stabilize
`packages/contracts`

### First functional package to extract
`packages/graph-core`

### First hosted API to shape
`services/graphrag-api`

## Proposed Build Order

1. set up monorepo scaffolding
2. move SOPHIA into `apps/sophia`
3. create `packages/contracts`
4. create `packages/graph-core`
5. create `packages/observability`
6. stand up `apps/restormel-web`
7. build Restormel Graph MVP
8. extract `packages/graphrag-core`
9. stand up `services/graphrag-api`
10. extract `packages/reasoning-core`

## Definition of Done for the Blueprint Phase

This blueprint phase is complete when:

- the monorepo exists
- the folder structure is in place
- package names are reserved
- core workspace tooling is configured
- SOPHIA can build inside the monorepo
- at least one extracted package is consumed by SOPHIA

## Summary

The monorepo blueprint should optimize for **safe extraction, reusable contracts, and product visibility**. The key move is not to break everything apart immediately, but to create a platform-shaped repository that allows Restormel products to emerge cleanly while SOPHIA keeps functioning as the reference app.
