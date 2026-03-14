# Restormel Build Pack 01: Monorepo Folder Blueprint

## Purpose
Define the target monorepo structure for Restormel and the migration path from SOPHIA.

## Recommended repository model
Use a single monorepo first.

Why:
- extraction is still active
- package boundaries matter more than repo boundaries right now
- SOPHIA still needs to consume shared modules during transition
- a monorepo lowers coordination cost while the contracts settle

## Target repository name
`restormel`

## Top-level structure
```text
/apps
  /sophia
  /restormel-web
/packages
  /contracts
  /graph-core
  /reasoning-core
  /evals
  /adapters
  /observability
  /ui
  /providers
/tooling
/docs
```

## Folder responsibilities

### `apps/sophia/`
Reference application and first downstream consumer.

### `apps/restormel-web/`
Homepage, docs, playground, and authenticated workspace shell.

### `packages/contracts/`
Canonical reasoning object contracts and validators.

### `packages/graph-core/`
Graph transforms, traversal, diffing, and utilities.

### `packages/reasoning-core/`
Compilation of traces, retrieval, and evidence into reasoning objects.

### `packages/evals/`
Graph-aware evaluators and comparison summaries.

### `packages/adapters/`
Thin import/export adapters.

### `packages/observability/`
Internal inspection and event helpers for Restormel surfaces.

### `packages/ui/`
Reusable workspace UI and typed view models.

### `packages/providers/`
Minimal provider abstractions only where needed.

### `tooling/`
CI, linting, codemods, release helpers, and scripts.

## Repository rules
- extract by package boundary, not by aspiration
- do not create packages for future hypotheticals
- keep commodity substrate ownership thin
- keep UI separate from core reasoning logic
- use adapters to isolate SOPHIA-specific shapes
