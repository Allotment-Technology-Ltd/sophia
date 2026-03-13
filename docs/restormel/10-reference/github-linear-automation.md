---
title: Restormel GitHub and Linear Automation Operations
owner: platform-delivery
product: restormel
doc_type: automation_reference
last_reviewed: 2026-03-13
sync_to_linear: false
---

# Restormel GitHub and Linear Automation Operations

## Purpose
This automation layer keeps repository documentation governable and mirrors actionable platform delivery items into Linear.

Direction is one-way only:
- GitHub docs -> Linear
- no reverse sync from Linear -> docs

For delivery sync, `docs/restormel` remains the Linear-facing source of truth.

For documentation maintenance and freshness, automation should consider the full docs tree:
- `docs/sophia`
- `docs/restormel`
- `docs/reference`
- `docs/archive`

## What Was Added
- `scripts/restormel/docs_lint.py`
- `scripts/restormel/stale_docs.py`
- `scripts/restormel/sync_linear.py`
- `.github/workflows/docs-lint.yml`
- `.github/workflows/docs-freshness.yml`
- `.github/workflows/linear-sync.yml`
- `docs/restormel/meta/linear-map.yml`
- `docs/restormel/meta/owners.yml`
- `docs/restormel/meta/milestones.yml`
- `.github/ISSUE_TEMPLATE/*` forms and `.github/pull_request_template.md`

## Required Front Matter for Delivery Docs
Key delivery docs must include:
- `title`
- `owner`
- `product`
- `doc_type`
- `last_reviewed`
- `sync_to_linear`

The sync parser currently expects headings in these forms:
- `## Milestone: ...`
- `## Epic: ...`
- `## Surface: ...`

## Environment Variables and GitHub Secrets
Required for sync:
- `LINEAR_TEAM_ID`
- `LINEAR_API_KEY` (required for non-dry-run modes)

Optional:
- `LINEAR_DEFAULT_ASSIGNEE`
- `LINEAR_PROJECT_PREFIX`
- `LINEAR_PROJECT_ID`
- `LINEAR_LABELS` (comma-separated label names)

Typical GitHub setup:
- secrets: `LINEAR_TEAM_ID`, `LINEAR_API_KEY`, optional IDs
- vars: optional `LINEAR_PROJECT_PREFIX`, `LINEAR_LABELS`

## Local Usage
### Lint docs metadata
```bash
python3 scripts/restormel/docs_lint.py --check-links
```

### Report stale docs
```bash
python3 scripts/restormel/stale_docs.py --days 60
```

JSON output for automation:
```bash
python3 scripts/restormel/stale_docs.py --days 60 --format json
```

### Sync to Linear (dry-run)
```bash
export LINEAR_TEAM_ID="<team-id>"
python3 scripts/restormel/sync_linear.py --mode dry-run
```

### Sync to Linear (apply create)
```bash
export LINEAR_TEAM_ID="<team-id>"
export LINEAR_API_KEY="<api-key>"
python3 scripts/restormel/sync_linear.py --mode create
```

### Sync to Linear (apply create + update)
```bash
python3 scripts/restormel/sync_linear.py --mode create-update
```

## How Duplicate Prevention Works
`docs/restormel/meta/linear-map.yml` stores stable identity keys for synced items.

Identity format:
- `<kind>:<doc-path>#<normalized-title>`

When an item already exists in `linear-map.yml`, sync will not create a duplicate.
- `--mode update` or `--mode create-update` can update mapped issues.

## Contributor Rules for Sync-Compatible Docs
- Keep delivery headings parseable (`Milestone`, `Epic`, `Surface` patterns).
- Keep front matter present and accurate.
- Avoid changing heading text casually; heading text is part of identity keys.
- If a heading must change, review `linear-map.yml` impact in the same PR.
- Do not add autonomous AI rewriting workflows for delivery docs.

## Documentation Maintenance Rule

Any automation that checks documentation freshness, metadata, or navigability should include all maintained documentation, not just `docs/restormel`.

Minimum scope:
- active SOPHIA docs
- active Restormel docs
- reference docs

Archive docs may be linted for metadata and broken links, but should not be surfaced as current operational guidance by default.
