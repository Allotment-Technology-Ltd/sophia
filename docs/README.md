---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-04-11
---

# Documentation index

This is the landing page for the **public** documentation surface shipped with the repository.

- [`docs/sophia/`](sophia/README.md) — active SOPHIA showcase/reference-app narrative (architecture, roadmap, product role, domains, changelog).
- [`docs/LOCAL_DOCS.md`](LOCAL_DOCS.md) — how to populate **`docs/local/`** with the Restormel platform pack, operations runbooks, reference library, archive, and related notes **without publishing them on public Git**.

## Documentation surfaces

<!-- GENERATED:docs-map:start -->
| Surface | Status | Docs | Use it for | Entry point |
| --- | --- | --- | --- | --- |
| SOPHIA | Public | 7 | Showcase/reference app documentation shipped with the public repo. | [SOPHIA Documentation](sophia/README.md) |
| Maintainer pack | Local only | — | Restormel, operations, reference, and archive material under docs/local/ (not published on public Git). | [Maintainer documentation pack](LOCAL_DOCS.md) |
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
| Changelog | [Changelog](sophia/changelog.md) |
| Maintainer documentation pack | [Maintainer documentation pack](LOCAL_DOCS.md) |
<!-- GENERATED:key-doc-entry-points:end -->

## Public vs maintainer-only

Hand-authored meaning in `docs/sophia/` is what ships on the public default checkout. Historical, operational, and Restormel platform material stays under `docs/local/` for maintainers — see [`LOCAL_DOCS.md`](LOCAL_DOCS.md).

<!-- GENERATED:active-vs-archive:start -->
| Class | Current snapshot | Operating rule |
| --- | --- | --- |
| Public SOPHIA slice | 7 active-tagged docs under docs/sophia/ | Shipped with the public repository; keep aligned with the product surface. |
| Maintainer-only tree | Restormel platform pack, operations runbooks, reference library, and archive under docs/local/ when populated. | [Maintainer documentation pack](LOCAL_DOCS.md) |
| Historical / internal | Lives under docs/local/ on maintainer machines; not published on the public default checkout. | Do not treat archived paths as current guidance unless promoted into the public SOPHIA slice. |
<!-- GENERATED:active-vs-archive:end -->

## Repository root

The top-level [README.md](../README.md) duplicates navigation paths for GitHub visitors (including generated tables maintained by `scripts/restormel/update_repo_docs.py`).

## If this folder looks empty or incomplete locally

1. **Update from `main`:** `git pull origin main`
2. **Force-restore the public slice from Git** (does not remove your untracked `docs/local/` tree):  
   `git fetch origin && git checkout origin/main -- docs/README.md docs/LOCAL_DOCS.md docs/sophia/`
3. **Verify paths:** from repo root, `pnpm run docs:verify-present`  
   (public files always; Restormel meta only if `docs/restormel/` or `docs/local/restormel/` exists).

If `git status` never shows changes under tracked `docs/` files when you edit them, inspect **`.gitignore`** for a line like `docs/*` — that pattern hides the tree from Git and breaks CI; remove it and restore with step 2.
