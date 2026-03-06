# SOPHIA Documentation

**Last updated:** 2026-03-06  
**Status:** Reorganized for clarity; active maintenance rules in [rules.yaml](../rules.yaml)

---

## Quick Navigation

### 🎯 Start Here
- **[ROADMAP.md](../ROADMAP.md)** ← **Single source of truth** for what's built + what's next
- **[STATUS.md](../STATUS.md)** — Operational health, deployment status, contacts
- **[CHANGELOG.md](../CHANGELOG.md)** — Version history and milestone dates

---

## Core References

### System Architecture
- **[architecture.md](architecture.md)** — Deployment diagram, tech stack, key components
- **[argument-graph.md](argument-graph.md)** — SurrealDB schema reference (sources, claims, relations, arguments)
- **[three-pass-engine.md](three-pass-engine.md)** — Why three passes? Motivation, per-pass rules, output format

### Knowledge & Design
- **[prompts-reference.md](prompts-reference.md)** — All LLM prompt templates, organized by phase and domain
- **[design/sophia-design-system-B.md](design/sophia-design-system-B.md)** — Locked design tokens, colors, typography
- **[evaluation-methodology.md](evaluation-methodology.md)** — Testing rubric, ground truth, how we measure quality

### Operations
- **[runbooks.md](runbooks.md)** — Quick commands, health checks, common operations
- **[GCP-ORG-MIGRATION.md](GCP-ORG-MIGRATION.md)** — Full GCP project transfer runbook

---

## Implementation Guides

### Phase 3c (MVP Pivot) — In Progress
- **[design/MASTER-IMPLEMENTATION-GUIDE.md](design/MASTER-IMPLEMENTATION-GUIDE.md)** — UI implementation (canonical guide)
- **[design/sophia-phase3c-ui-prompt-guide.md](design/sophia-phase3c-ui-prompt-guide.md)** — UI architecture notes + corrections
- **[MVP-PIVOT-PLAN.md](MVP-PIVOT-PLAN.md)** — Full Phase A–J breakdown (grounding, embeddings, auth, etc)

### Future Phases (4–7)
- **[design/sophia-phases-4-7-prompt-guide.md](design/sophia-phases-4-7-prompt-guide.md)** — Phase 4 (web search), Phase 5+ roadmap

### Onboarding
- **[AGENT-IMPLEMENTATION-PROMPT.md](AGENT-IMPLEMENTATION-PROMPT.md)** — AI agent onboarding guide
- **[MIGRATION-QUICKSTART.md](MIGRATION-QUICKSTART.md)** — GCP migration quick reference

---

## Archived Documents

**[archive/README.md](archive/README.md)** — All completed-phase documents stored here for historical reference.

Examples:
- Phase 3a completion report  
- Phase 3b checklists and roadmaps
- Resolved issues and optimizations
- Empty templates and one-time task prompts

---

## How These Docs Relate

```
ROADMAP.md ← Single source of truth for "what's left"
    ↓
    ├─ Points to architecture.md for "how it works"
    ├─ Points to design/ guides for "how to build it"
    ├─ Points to prompts-reference.md for "what to say"
    └─ Points to evaluation-methodology.md for "how to test it"

STATUS.md ← Operational snapshot (updated per-deploy)
CHANGELOG.md ← Milestone history (append per-release)
```

---

## Maintenance

Documentation is reviewed every sprint via `scripts/review-docs.sh`:

```bash
./scripts/review-docs.sh              # Check integrity
./scripts/review-docs.sh --strict     # Warn on staleness
```

**These checks:**
- Verify canonical docs exist and are up-to-date
- Detect broken links
- Flag stale docs (>2 weeks without update)
- Ensure no "TODO: update this" placeholders
- Confirm archive has README

**Update responsibility:**
- After release: update ROADMAP + STATUS + CHANGELOG together
- On schema change: update argument-graph.md immediately  
- On prompt change: add entry to prompts-reference.md with date
- On phase completion: move old checklists to archive/

---

## Document Conventions

Every document has frontmatter:
```markdown
# Title

**Last updated:** YYYY-MM-DD  
**Status:** active | archived | draft | reference  
**Owner:** @name or Copilot  
**Related:** [link](path.md) | [link](path.md)
```

---

## Forbidden Practices

❌ Storing docs outside `docs/` (except ROADMAP.md, STATUS.md, CHANGELOG.md at root)  
❌ "This is outdated" without moving to archive/  
❌ Two conflicting docs on same topic  
❌ Promising to update docs later (file a GitHub issue instead)  
❌ Documentation longer than 100 lines without a table of contents  

---

## Tools

- **Frontmatter template:** See any doc in this folder
- **Doc review script:** `scripts/review-docs.sh`
- **Rules:** See [rules.yaml](../rules.yaml) section `documentation`
