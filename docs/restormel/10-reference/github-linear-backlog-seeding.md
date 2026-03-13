---
title: Linear Backlog Seeding Reference
owner: platform-delivery
product: restormel
doc_type: automation_reference
last_reviewed: 2026-03-13
sync_to_linear: false
---

# GitHub-to-Linear Backlog Seeding

This guide explains how the Restormel docs auto-seed Linear with the right projects, milestones, and backlog items so the delivery mirror stays in sync without reverse writes.

## What is automated
- **Project seeding** – `linear-config.yml` declares the six canonical Linear projects (Platform Extraction, Restormel Graph MVP, GraphRAG MVP, restormel.dev, SOPHIA Migration, Documentation Rationalisation) along with keyword mappings, priorities, and stage ownership. The sync script will create or reconcile those projects before it creates work.
- **Milestone seeding** – The milestone plan file drives `projectMilestones` creation. Each milestone is tied to a specific project key so Linear has the expected list of roadmap checkpoints.
- **Backlog seeding** – `docs/restormel/04-delivery/*` and `05-design/21-design-backlog-by-surface.md` headings are parsed (Milestones, Epics, Surfaces, Stages). Bullet lists immediately below each heading turn into task-level issues (a small, configurable subset). Parsed items respect owner front matter, doc paths, and stage context.
- **Priority assignment** – Each project definition carries a default Linear priority (1–4). The script applies those priorities to every issue so the most urgent work remains visible.
- **Idempotency guardrail** – `docs/restormel/meta/linear-map.yml` stores every synced item, project, and milestone with unique keys, preventing duplicates across re-runs.
- **Summary & tracing** – When invoked with `--github-summary`, the script writes sections for projects, milestones, and issues into `GITHUB_STEP_SUMMARY`.

## Configuration overview
- `docs/restormel/meta/linear-config.yml` contains:
  - canonical project names, keywords, and the stage/project assignments
  - milestone → project map
  - task limit for how many bullet children per heading are synced
  - default priority and stage/project mappings for launch stages
- `docs/restormel/meta/owners.yml` maps logical doc owners to Linear assignee IDs and provides label/project defaults.
- `docs/restormel/meta/milestones.yml` lists the canonical milestone names referenced in `linear-config.yml`.
- `docs/restormel/meta/linear-map.yml` is the sync state file that the script rewrites in apply mode.

## Environment variables and secrets
- `LINEAR_TEAM_ID` – the Linear team UUID or readable key. Required for all runs.
- `LINEAR_API_KEY` – personal or machine API key. Required if you are not in `dry-run`.
- `LINEAR_PROJECT_ID` – optional override that forces every issue into a single project instead of the config-driven map.
- `LINEAR_DEFAULT_ASSIGNEE` – fallback assignee if a doc owner lacks a valid Linear ID.
- `LINEAR_PROJECT_PREFIX` – prefix injected into every generated issue title.
- `LINEAR_LABELS` – comma-separated label names applied to every created issue.

## Running the sync
1. **Dry-run (recommended first):**

```bash
export LINEAR_TEAM_ID="<team-id>"
python3 scripts/restormel/sync_linear.py --mode dry-run
```

The script will print plans for new projects, milestones, and issues plus totals at the end.

2. **Apply (safe creation/update):**

```bash
export LINEAR_API_KEY="<api-key>"
python3 scripts/restormel/sync_linear.py --mode create-update
```

Projects/milestones will be created only if missing. Existing issues are updated when necessary.

3. **Manual toggle:** The workflow (`.github/workflows/linear-sync.yml`) exposes a boolean `apply` input so GitHub UI runs default to dry-run and require explicit apply.

## Operational notes
- Run the dry-run before any apply run to inspect the summary and verify the config mappings are correct.
- Every issue description includes the source doc path and heading and — if it was generated from a child bullet — a link to the parent issue.
- `linear-map.yml` keeps each Linear entity’s identifier so the script only creates what is missing.
- The script is deterministic because it sorts keys and uses slugified headings for identities.
- Backlog tasks are intentionally limited (by `task_limits.max_children_per_item`) to avoid overwhelming the first seed.

## What remains manual
- Fill in actual Linear assignee IDs in `docs/restormel/meta/owners.yml`.
- Confirm the Linear team, project names, and stage mapping before running apply mode.
- If a heading changes (text or doc path), update `linear-map.yml` to avoid dangling entries.
- Linear labels, milestones, or projects not declared in `linear-config.yml` must be created by hand.
- Retrospective verification (e.g., inspect Linear and the doc after a run) is still best practice.

