---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

# Rationalisation Summary

## What was created

### New active SOPHIA source-of-truth set

- `docs/sophia/README.md`
- `docs/sophia/current-state.md`
- `docs/sophia/architecture.md`
- `docs/sophia/product-role.md`
- `docs/sophia/roadmap.md`
- `docs/sophia/domain-expansion.md`
- `docs/sophia/changelog.md`
- `docs/sophia/documentation-governance.md`

### Review and audit files

- `docs/sophia/rationalisation-inventory.md`
- `docs/sophia/rationalisation-summary.md`

### Archive structure

- `docs/archive/strategy/`
- `docs/archive/architecture/`
- `docs/archive/delivery/`
- `docs/archive/product/`
- `docs/archive/experiments/`

### Reference structure

- `docs/reference/api/`
- `docs/reference/architecture/`
- `docs/reference/operations/`
- `docs/reference/product/`
- `docs/reference/learning/`

## What was rewritten or clarified

- Root repo docs were aligned to the new model:
  - `README.md` rewritten as an aligned repo front door
  - `ROADMAP.md` redirected to `docs/sophia/roadmap.md`
  - `STATUS.md` redirected to `docs/sophia/current-state.md`
  - `CHANGELOG.md` redirected to `docs/sophia/changelog.md`
- `docs/README.md` was rewritten as a neutral documentation index.
- `docs/reference/README.md` was added as the reference-docs front door.
- `docs/architecture.md` was converted into a superseded redirect.
- `docs/archive/README.md` was rewritten as the archive front door.
- `docs/restormel/00-overview/00-master-index.md` was rewritten with real repo-relative links and active metadata.

## What was moved

### Into `docs/reference/`

- API reference and OpenAPI artifacts
- schema and prompt references
- runbooks and operational notes
- copy, accessibility, and writing references
- learn-pedagogy references

### Into `docs/archive/architecture/`

- argument-native platform roadmap
- unified architecture roadmap
- three-pass engine explainer
- SurrealDB 3 investigation
- phased runtime/nightly-ingestion plan

### Into `docs/archive/delivery/`

- reingestion and cutover plans
- phase closeout baseline and historical phase checklists
- ingestion analysis and migration runbooks/history
- older documentation reorganisation summary

### Into `docs/archive/product/`

- argument-map and graph-map product plans
- BYOK and consumer monetisation rollout plans
- graph visualisation implementation history
- historical design-system and implementation guides
- retained legacy `.docx` design artifacts

### Into `docs/archive/strategy/`

- MVP pivot plan
- SOPHIA strategic roadmap v2

### Into `docs/archive/experiments/`

- evaluation methodology baseline
- deferred frontier overhaul
- prompt artifacts and tuning logs

## What was marked active, reference, archived, or superseded

### Active

- the full `docs/sophia/` source-of-truth set
- active Restormel platform docs under `docs/restormel/`
- `README.md` as a repo front door
- `docs/README.md` as a neutral docs index

### Reference

- runbooks, API/schema/prompt docs, copy and accessibility references
- Restormel assessment/reference docs
- learn-pedagogy docs that support an active surface but are not part of the minimal active set
- archive and rationalisation indices

### Archived

- historical planning packs
- historical delivery checkpoints and implementation notes
- old design-system and prompt-guide material
- older migration and infrastructure notes

### Superseded

- root roadmap/status/changelog docs
- repo-level SOPHIA architecture doc
- selected archived plans that were clearly replaced by the new active source-of-truth set

## Ambiguous docs left for later human review

- `docs/Learn Module/*.md`
  - kept as `reference`
  - reason: the learn surface is active in the repo, but these files are detailed pedagogy notes rather than core product-truth docs
- `docs/api-development-portal-roadmap.md`
  - kept as `reference`
  - reason: still useful as a focused plan, but too specific to remain part of the main active roadmap surface
- `docs/openapi/sophia-v1.yaml`
  - left in place as a reference artifact
  - reason: operationally important but outside the narrative doc framework

## Assumptions made

1. The current worktree doc moves were part of the intended documentation baseline and could be overwritten during rationalisation.
2. The Restormel framing is the winning strategic frame whenever older SOPHIA docs conflict with it.
3. Historical plan documents are more useful preserved in archive buckets than left on the active docs surface.
4. Learn-module docs should not be forced into the archive while the learn product surface remains live in the repo.
5. The active SOPHIA set should stay intentionally small even though the repo contains many supporting references.

## Manual review still recommended

1. Review whether the Learn surface now deserves its own active documentation page under `docs/sophia/` in a future pass.
2. Review whether any retained reference docs should be further relocated once the platform extraction work advances.
3. Sanity-check internal links inside older archived documents if those files are expected to be used heavily again; the active surface is corrected, but some historical cross-links may still reflect pre-rationalisation locations.
