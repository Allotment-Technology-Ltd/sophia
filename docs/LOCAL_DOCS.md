---
title: Maintainer documentation pack
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-04-12
---

# Maintainer documentation pack (`docs/local/`)

The public GitHub default for this repository tracks a **small, stable SOPHIA-facing doc set** under `docs/README.md` and `docs/sophia/`.

Everything else—Restormel platform pack, operations runbooks, reference library, archive, Stoa materials, and related root-level notes—lives under **`docs/local/`** on maintainer machines. That directory is **gitignored** and is **not** pushed to the public remote.

## Populating `docs/local/`

Use whichever fits your team:

1. **Private git remote or bundle** — merge or extract the doc tree into `docs/local/` (preserving inner layout: `docs/local/restormel/`, `docs/local/operations/`, `docs/local/archive/`, etc.).
2. **Copy from an internal checkout** — rsync or copy from a machine that already has the full tree.
3. **Historical checkout** — `git show <commit>:docs/restormel > …` is workable for one-off recovery but poor for ongoing sync; prefer a private mirror.

Expected top-level layout inside `docs/local/` (example):

- `archive/`, `admin/`, `decisions/`, `modules/`, `operations/`, `reference/`
- `restormel/`, `restormel-integration/`
- `stoa/`, `stoa_game/`, `stoa_game_intro/`
- `sophia/` — internal-only SOPHIA notes moved out of the public `docs/sophia/` slice
- Root markdown files such as `restormel-dogfood-relay.md`, `ingestion-self-heal-restormel-handoff.md`

## Automation

Scripts such as `scripts/restormel/update_repo_docs.py` and `docs_lint.py` run in CI against the **public** doc slice. When `docs/local/` is present locally, optional tooling (e.g. Linear sync, stale-doc reports) can use paths under `docs/local/restormel/` if you point workflows or env at that tree on private runners.
