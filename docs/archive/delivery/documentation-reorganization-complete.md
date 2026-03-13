---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# Documentation Reorganization Complete

**Date:** March 6, 2026  
**Completed by:** GitHub Copilot  
**Status:** ✅ All tasks complete

---

## What Was Done

### 1. ✅ Cleaned Up Documentation
- **Archived 10 obsolete/completed-phase documents** to `docs/archive/`
  - Phase 3a completion report
  - Phase 3b checklist and roadmaps
  - Resolved issues (Wave 1, Org migration, Prompt tuning, Graph viz)
  - One-time task prompts (Ingest resume functionality)
  - Superseded migration plan

- **Created `docs/archive/README.md`** with clear explanation of why each doc was archived

### 2. ✅ Created Single Sources of Truth
- **`ROADMAP.md` (root)** — **CANONICAL** project roadmap
  - What's currently being built (Phase 3c, 60% done)
  - Completed phases with dates
  - Upcoming phases (4–8) with effort estimates
  - Quality gates for MVP completion
  - Designed for weekly updates post-sprint
  
- **Updated `docs/architecture.md`** — Now reflects post-pivot architecture
  - Gemini 2.5 Pro replaces Claude Sonnet
  - Vertex AI text-embedding-005 replaces Voyage AI
  - Google Search Grounding added
  - Firebase Auth + Firestore added
  - SurrealDB remains the persistent graph
  - Updated deployment diagram
  - Links to all reference documents

- **Status and Changelog remain for operational health** and version history

### 3. ✅ Organized Documentation by Category

**Canonical/Active (update every sprint):**
- ROADMAP.md (what's left to build)
- STATUS.md (deployment health)
- CHANGELOG.md (milestones by date)
- docs/architecture.md (system design)

**Implementation Guides:**
- docs/design/MASTER-IMPLEMENTATION-GUIDE.md (Phase 3c UI)
- docs/MVP-PIVOT-PLAN.md (Phase A–J technical breakdown)
- docs/AGENT-IMPLEMENTATION-PROMPT.md (AI agent onboarding)

**Reference Documents:**
- docs/argument-graph.md (SurrealDB schema)
- docs/three-pass-engine.md (dialectical design)
- docs/prompts-reference.md (all LLM templates)
- docs/evaluation-methodology.md (testing rubric)
- docs/runbooks.md (operational commands)

**Design/Locked Specs:**
- docs/design/sophia-design-system-B.md (Design B tokens — locked)
- docs/design/sophia-phase3c-ui-prompt-guide.md (UI architecture)
- docs/design/sophia-phases-4-7-prompt-guide.md (future phases)

**Archived (historical reference only):**
- docs/archive/ — 11 completed/obsolete documents
- docs/archive/README.md — explains why each is archived

### 4. ✅ Added Maintenance Rules to rules.yaml
New `documentation:` section in `rules.yaml` includes:
- **Structure:** Directory layout with canonical vs reference docs
- **Maintenance frequency:** Every 2-week sprint or after major milestone
- **Responsibilities:** Who updates what and when
- **Conventions:** Frontmatter template, link format, section structure
- **Forbidden practices:** What NOT to do (two versions of truth, TODOs, etc)

### 5. ✅ Created Documentation Maintenance Scripts

**`scripts/review-docs.sh`** — Automated doc health checks
```bash
./scripts/review-docs.sh              # Standard review
./scripts/review-docs.sh --strict     # Flag stale docs
```

Checks:
- ✓ Canonical docs exist
- ✓ ROADMAP.md is recent (<2 weeks)
- ✓ Archive directory is organized
- ✓ No "TODO: update" placeholders
- ✓ No broken links
- ✓ No stray docs outside docs/ directory

**`scripts/docs-update-checklist.sh`** — Reminder checklist for milestones
Run after completing a phase/feature to ensure docs are updated together:
- Update ROADMAP.md (mark tasks, update progress)
- Update STATUS.md (deployment status)
- Update CHANGELOG.md (add entry)
- Update schema docs (if applicable)
- Move completed-phase docs to archive
- Run review-docs.sh to verify
- Commit doc updates with code

**`docs/README.md`** — Navigation guide
Explains:
- Quick navigation (start here links)
- How docs relate to each other
- Maintenance process
- Conventions and forbidden practices

---

## How to Use This System

### For Daily Development
1. **Check the roadmap:** `ROADMAP.md` tells you what's currently in-progress
2. **Reference the architecture:** `docs/architecture.md` explains the system
3. **Look up implementation details:** `docs/design/MASTER-IMPLEMENTATION-GUIDE.md` for Phase 3c

### For Completing a Feature
1. Update code
2. Update relevant docs (schema, prompts, design)
3. Run `./scripts/docs-update-checklist.sh` - follow the checklist
4. Run `./scripts/review-docs.sh --strict` - verify no issues
5. Commit everything together: `git commit -m "feat: description"` and `git commit -m "docs: description"`

### For Completing a Phase
1. Move old phase checklists to `docs/archive/`
2. Update `ROADMAP.md` (mark phase complete, update progress)
3. Update `STATUS.md`
4. Update `CHANGELOG.md`
5. Run `./scripts/review-docs.sh --strict`
6. Commit: `git commit -m "docs: Phase 3c complete"`

### Every 2 Weeks (Sprint End)
Run: `./scripts/review-docs.sh --strict`

This checks:
- ROADMAP.md hasn't drifted (last update <2 weeks)
- No broken docs or links
- Archive is organized
- No stray documentation

---

## Project Health Summary

**Documentation Status:** ✅ Reorganized, cleaned, with maintenance rules

**Current Build Status:**
- ✅ Phase 3b complete: 25/27 sources, ~7,500 claims
- 🚧 Phase 3c in-progress: 60% done
  - ✅ Engine grounding, embeddings, sophia-meta 
  - ⏳ Firebase Auth wiring (critical blocker)
  - ⏳ Firestore history/cache
  - ⏳ UI references panel
  
**Next Immediate Work:**
1. Wire Firebase Auth to all protected routes
2. Add Firestore query cache and history
3. Build References panel UI components
4. Delete unused passRefinement.ts
5. Test full flow end-to-end

---

## Files Modified/Created

### Modified
- `rules.yaml` — Added comprehensive `documentation:` section
- `docs/architecture.md` — Updated to reflect post-pivot architecture

### Created
- `ROADMAP.md` — Single source of truth for project roadmap
- `docs/README.md` — Documentation navigation and index
- `docs/archive/README.md` — Explanation of archived documents
- `scripts/review-docs.sh` — Automated documentation health checker
- `scripts/docs-update-checklist.sh` — Reminder for post-milestone updates

### Moved to Archive (docs/archive/)
- phase-3a-completion-report.md
- phase-3b-checklist.md
- phase-3b-roadmap.md
- phase-checklist.md
- CLOUD-DEPLOYMENT.md
- WAVE-1-INGESTION-ANALYSIS.md
- implementation-migration-plan-prompts.md
- graph-visualization-implementation.md
- prompt-tuning-log.md
- (root) RESUME_FUNCTIONALITY_PROMPT.md

---

## Key Principles Going Forward

1. **Single Source of Truth:** ROADMAP.md is canonical for "what's left to build"
2. **No Stale Docs:** Old docs move to archive immediately, don't clutter root
3. **Maintenance is Automatic:** `review-docs.sh` runs every sprint
4. **Docs Update with Code:** Same commit, same PR
5. **Clear Navigation:** `docs/README.md` explains how everything connects

---

## Next Steps (for humans)

✅ **Review:** Open `ROADMAP.md` and verify Phase 3c status is accurate for your current work

✅ **Plan Next Sprint:** Check ROADMAP.md Phase 3c tasks for your assignment

✅ **After Phase 3c Launch:** Use `scripts/docs-update-checklist.sh` to update all docs together

---

## Questions?

- **How do I find...?** → Start at `docs/README.md`
- **What should I build next?** → Check `ROADMAP.md`
- **Are these docs up-to-date?** → Run `./scripts/review-docs.sh`
- **How do I update docs?** → Run `./scripts/docs-update-checklist.sh`
- **Where do old docs go?** → `docs/archive/` with README explaining why
