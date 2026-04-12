---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-04-11
---

# Documentation index

This is the landing page for the repository documentation surface. The tree includes full Restormel planning, operations runbooks, reference material, and archive — not only the smallest public slice.

The structure is intentionally simple:

- [`docs/sophia/`](sophia/README.md) holds the active SOPHIA showcase/reference-app narrative
- [`docs/restormel/`](restormel/README.md) holds the active Restormel platform strategy, architecture, and delivery pack
- [`docs/reference/`](reference/README.md) holds maintained supporting reference material
- [`docs/archive/`](archive/README.md) preserves historical and superseded material

## Documentation surfaces

<!-- GENERATED:docs-map:start -->
| Surface | Status | Docs | Use it for | Entry point |
| --- | --- | --- | --- | --- |
| SOPHIA | Active | 10 | Showcase/reference app documentation. | [SOPHIA Documentation](sophia/README.md) |
| Restormel | Active | 47 | Platform planning, architecture, and delivery docs. | [Restormel Documentation](restormel/README.md) |
| Reference | Reference | 19 | Supporting implementation and operational references. | [Reference Documentation](reference/README.md) |
| Archive | Archived | 64 | Historical material preserved for traceability. | [Documentation Archive](archive/README.md) |
<!-- GENERATED:docs-map:end -->

## Key entry points

Start with the entry points below before browsing deeper folders.

<!-- GENERATED:key-doc-entry-points:start -->
| Document | Link |
| --- | --- |
| SOPHIA Documentation | [SOPHIA Documentation](sophia/README.md) |
| Current State | [Current State](sophia/current-state.md) |
| Architecture | [Architecture](sophia/architecture.md) |
| Roadmap | [Roadmap](sophia/roadmap.md) |
| Restormel Documentation | [Restormel Documentation](restormel/README.md) |
| Restormel Platform: Milestone Plan with Exit Criteria | [Restormel Platform: Milestone Plan with Exit Criteria](restormel/04-delivery/19-milestone-plan-with-exit-criteria.md) |
| Reference Documentation | [Reference Documentation](reference/README.md) |
| Documentation Archive | [Documentation Archive](archive/README.md) |
<!-- GENERATED:key-doc-entry-points:end -->

## Active vs archive

Narrative meaning stays hand-authored in the active docs. Archived material is retained for traceability but should not be treated as current guidance unless an active document explicitly sends you there.

<!-- GENERATED:active-vs-archive:start -->
| Class | Current snapshot | Operating rule |
| --- | --- | --- |
| Active source of truth | 10 SOPHIA docs and 47 Restormel docs | Update when product, architecture, or delivery meaning changes. |
| Supporting reference | 19 docs under docs/reference and 7 Restormel reference docs | Use for runbooks, API details, and automation context. |
| Archived | 64 docs under docs/archive | Do not treat as current guidance; start at [Documentation Archive](archive/README.md). |
<!-- GENERATED:active-vs-archive:end -->

## Repository root

The top-level [README.md](../README.md) duplicates navigation paths for GitHub visitors (including generated tables maintained by `scripts/restormel/update_repo_docs.py`).

## If this folder looks empty or incomplete locally

1. **Update from `main`:** `git pull origin main`
2. **Force-restore `docs/` from Git** (does not delete untracked files you added under `docs/`):  
   `git fetch origin && git checkout origin/main -- docs/`
3. **Verify core paths:** from repo root, `pnpm docs:verify-present`  
   (checks e.g. `docs/restormel/meta/linear-config.yml`).

If `git status` never shows changes under `docs/` when you edit tracked files, inspect **`.gitignore`** for a line like `docs/*` — that pattern hides the tree from Git and breaks CI; remove it and restore with step 2.
