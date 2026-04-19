---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-04-11
---

# SOPHIA

SOPHIA is the showcase and reference application for the Restormel platform.

This repository combines the live SOPHIA product implementation with the Restormel platform direction. **Public GitHub** carries a small SOPHIA-facing documentation slice plus [`docs/LOCAL_DOCS.md`](docs/LOCAL_DOCS.md) explaining how maintainers keep the full Restormel, operations, reference, and archive trees **locally** under `docs/local/` (gitignored, not pushed to the public remote). Deeper runbooks and platform packs are not in the public `docs/` tree.

## Project identity

`Restormel` is the platform and product family.

`SOPHIA` is the showcase/reference app that proves the platform in a real product: graph-grounded reasoning, verification, explainability, BYOK, billing, API surfaces, and philosophy learning all meet here first.

## Start here

<!-- GENERATED:key-links:start -->
| Area | Why it matters | Start here |
| --- | --- | --- |
| SOPHIA docs | Public showcase app docs: architecture, roadmap, domain status, changelog. | [SOPHIA Documentation](docs/sophia/README.md) |
| Documentation hub | Public documentation index and how to obtain the maintainer doc pack. | [Documentation index](docs/README.md) |
| Maintainer doc pack | Restormel platform pack, operations, reference, archive (local only; not on public Git). | [Maintainer documentation pack](docs/LOCAL_DOCS.md) |
<!-- GENERATED:key-links:end -->

## Documentation map

Use the active docs surfaces below before reaching for older repo notes or archived plans.

<!-- GENERATED:repo-doc-map:start -->
| Status | Surface | Docs | Scope | Entry point |
| --- | --- | --- | --- | --- |
| Public | SOPHIA | 8 | Showcase app identity, architecture, roadmap, domains, and changelog. | [SOPHIA Documentation](docs/sophia/README.md) |
| Maintainer | Full doc tree | — | Restormel platform pack, operations runbooks, reference library, and archive (not on public Git; see LOCAL_DOCS). | [Maintainer documentation pack](docs/LOCAL_DOCS.md) |
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
_(Priority order lives in the maintainer doc pack: `docs/local/restormel/04-delivery/19-milestone-plan-with-exit-criteria.md`. See `docs/LOCAL_DOCS.md`.)_
<!-- GENERATED:current-priorities:end -->

## Repository structure

The codebase still contains both product implementation and platform extraction work.

<!-- GENERATED:repo-structure:start -->
- [`src/`](src) SvelteKit application, server logic, and UI surfaces.
- [`docs/`](docs) Public documentation index plus SOPHIA narrative; full pack under docs/local/ for maintainers.
- [`scripts/`](scripts) Operational tooling, ingestion utilities, and docs automation.
- [`tests/`](tests) Playwright end-to-end coverage.
- [`data/`](data) Source data and ingestion inputs.
- Production deployment: Railway (`usesophia.app`) via [`deploy.yml`](.github/workflows/deploy.yml). Runbook: `docs/sophia/deployment-railway.md`. Legacy GCP layout notes remain archival under `docs/local/operations/gcp-infrastructure.md`.
<!-- GENERATED:repo-structure:end -->

## Active vs maintainer-only

Use `docs/sophia/` for the **public** SOPHIA product narrative (architecture, roadmap, domains, changelog). Platform planning packs, runbooks, reference libraries, and archives live in the **maintainer documentation tree** under `docs/local/` when populated; see [`docs/LOCAL_DOCS.md`](docs/LOCAL_DOCS.md).

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

## Documentation on disk

On **`main`**, Git tracks a **small public `docs/` slice** (index, `LOCAL_DOCS.md`, and `docs/sophia/*`). The full Restormel, operations, and archive trees live under **`docs/local/`** on maintainer machines only — see [`docs/LOCAL_DOCS.md`](docs/LOCAL_DOCS.md).

**Refresh the public slice from remote `main`:**

```bash
git fetch origin
git checkout origin/main -- docs/README.md docs/LOCAL_DOCS.md docs/sophia/
```

**Or update the whole repo:**

```bash
git pull origin main
```

**Sanity check** (public paths; optionally Restormel meta if that tree exists locally):

```bash
pnpm run docs:verify-present
```

**If `git pull` says “Need to specify how to reconcile divergent branches”:** use an explicit strategy, e.g. `git pull --rebase origin main`, or commit/stash then `git fetch origin && git rebase origin/main`. To sync with the scripted workflow: `pnpm run git:sync-main -- "your message"` (see `scripts/git-sync-and-push-main.sh`).
