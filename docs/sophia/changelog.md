---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Changelog

## 2026-03-13

### Documentation rationalisation

- created the active `docs/sophia/` source-of-truth set
- aligned SOPHIA documentation to the agreed model: `Restormel = platform`, `SOPHIA = showcase/reference app`
- normalised active platform docs under `docs/restormel/` (later relocated to `docs/local/` for public-repo hygiene; see `docs/LOCAL_DOCS.md`)
- moved superseded plans and historical implementation material into archive categories (now under `docs/local/archive/` in maintainer checkouts)
- converted conflicting root-level SOPHIA roadmap/status/architecture docs into redirect stubs

## 2026-03-13

### Documentation governance introduced

- added explicit doc classification rules: `active`, `reference`, `archived`, `superseded`
- established the rule that each major SOPHIA topic has one active source-of-truth document
- preserved historical material rather than deleting it silently

## Before 2026-03-13

Older product and implementation history remains available under `docs/local/archive/` when the maintainer pack is present, and in Git history.
