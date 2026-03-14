---
title: Repository Documentation Maintenance
owner: platform-delivery
product: restormel
doc_type: automation_reference
last_reviewed: 2026-03-13
sync_to_linear: false
---

# Repository Documentation Maintenance

## Purpose

This document explains how the public-facing documentation layer is maintained without allowing uncontrolled AI rewriting of the repository narrative.

## Hand-authored documents and sections

The following meaning-bearing sections remain manual and should be edited by a human when the product or platform meaning changes:

- `README.md`: project identity, SOPHIA/Restormel relationship, repo purpose, local development guidance
- `docs/README.md`: explanation of the docs structure and active vs archived usage rules
- `docs/restormel/README.md`: Restormel identity, pack purpose, navigation guidance
- `docs/sophia/README.md`: SOPHIA identity, showcase/reference-app role, narrative framing
- active source-of-truth documents under `docs/sophia/`
- strategy, architecture, product, and delivery documents under `docs/restormel/`

## Auto-generated sections

Only low-risk structural sections are generated. They are replaced in place inside explicit markers and never by rewriting an entire document.

Current generated block markers:

- `key-links`
- `repo-doc-map`
- `repo-structure`
- `current-priorities`
- `docs-map`
- `key-doc-entry-points`
- `active-vs-archive`
- `active-restormel-docs`
- `restormel-delivery-docs`
- `restormel-reference-docs`
- `sophia-key-links`
- `active-sophia-docs`
- `sophia-current-focus`

Marker format:

```html
<!-- GENERATED:block-name:start -->
...
<!-- GENERATED:block-name:end -->
```

## Update workflow

Generated blocks are maintained by:

- script: `python3 scripts/restormel/update_repo_docs.py --write`
- validation: `python3 scripts/restormel/update_repo_docs.py --check`
- CI workflow: `.github/workflows/docs-lint.yml`

The updater is deterministic. It reads the current docs tree, front matter, and specific structured headings, then replaces only the named blocks in:

- `README.md`
- `docs/README.md`
- `docs/restormel/README.md`
- `docs/sophia/README.md`

If a required marker is missing, the script fails instead of guessing where to write.

## What can be updated automatically

Safe generated sections include:

- documentation maps
- active docs lists
- link tables
- repo structure summaries
- last-reviewed snapshots already present in front matter
- current priorities copied from structured source lists

These are intentionally narrow. The updater must not generate marketing copy, architecture explanations, or new strategic claims.

## When humans should update docs manually

Update narrative docs during a sprint when:

- SOPHIA’s product role changes
- Restormel platform boundaries or strategy change
- architecture meaning changes
- roadmap meaning changes
- active vs archived classification changes

In normal operation, manual updates should usually happen about once per sprint, plus any meaningful product or architecture pivot.

## Sprint review checklist

Review these during sprint review or release review:

- `README.md` narrative still matches the active docs set
- `docs/sophia/current-state.md` and `docs/sophia/roadmap.md` still describe the live app
- `docs/restormel/04-delivery/19-milestone-plan-with-exit-criteria.md` still matches delivery reality
- `docs/restormel/04-delivery/20-engineering-backlog-by-epic.md` still reflects the real backlog structure
- archive moves are explicit when a formerly active document is replaced
- generated blocks are refreshed after doc moves or title changes

## Local contributor commands

```bash
python3 scripts/restormel/update_repo_docs.py --check
python3 scripts/restormel/update_repo_docs.py --write
python3 scripts/restormel/docs_lint.py --check-links
python3 scripts/restormel/stale_docs.py --days 60
```
