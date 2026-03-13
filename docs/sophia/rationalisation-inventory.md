---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

# Rationalisation Inventory

This inventory captures the repository documentation surface reviewed during the 2026-03-13 rationalisation.

Notes:
- `docs/Restormel/...` was normalised to `docs/restormel/...` during implementation.
- The inventory records the pre-rationalisation paths where that is useful for auditability.
- Content-like lesson files under `data/` are out of scope; this inventory focuses on documentation and operational/reference material.

## Root documentation

| Path | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `README.md` | SOPHIA | Repo front door | active | Rewrite to align with `Restormel = platform`, `SOPHIA = showcase/reference app`; point to active docs. | `docs/sophia/README.md` |
| `ROADMAP.md` | ROADMAP | SOPHIA roadmap | superseded | Preserve as redirect only. | `docs/sophia/roadmap.md` |
| `STATUS.md` | STATUS | Current state / status | superseded | Preserve as redirect only. | `docs/sophia/current-state.md` |
| `CHANGELOG.md` | SOPHIA Changelog | High-level change log | superseded | Preserve as redirect only. | `docs/sophia/changelog.md` |
| `CONTRIBUTING.md` | Contributing to SOPHIA | Contribution process | reference | Keep in place; add metadata so it does not compete with product/architecture docs. | — |

## Active and supporting docs outside Restormel

| Path | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/README.md` | SOPHIA — Documentation Index | Repo docs landing page | active | Rewrite as neutral index that points to `docs/sophia`, `docs/restormel`, reference docs, and archive. | — |
| `docs/architecture.md` | Architecture | SOPHIA architecture | superseded | Keep as redirect only. | `docs/sophia/architecture.md` |
| `docs/accessibility-rules.md` | SOPHIA Accessibility Rules | Accessibility reference | reference | Keep in place as supporting reference. | — |
| `docs/api-development-portal-roadmap.md` | API Development Portal Roadmap (Zuplo + PostHog) | API/product delivery plan | reference | Keep in place with metadata; supporting plan, not primary roadmap truth. | — |
| `docs/api-v1.md` | SOPHIA Reasoning API v1 | API reference | reference | Keep in place with metadata. | — |
| `docs/argument-graph.md` | SOPHIA — Argument Graph Schema | Graph/schema reference | reference | Keep in place with metadata. | — |
| `docs/copy-dictionary.md` | SOPHIA Copy Dictionary | Product language reference | reference | Keep in place with metadata. | — |
| `docs/prompts-reference.md` | SOPHIA — Prompts Reference | Prompt reference | reference | Keep in place with metadata. | — |
| `docs/runbooks.md` | Runbooks & shortcuts — sophia | Runbook index | reference | Keep in place with metadata. | — |
| `docs/references/essay-writing-basics-summary.md` | Essay writing basics summary | Writing quality reference | reference | Keep in place with metadata. | — |
| `docs/openapi/sophia-v1.yaml` | SOPHIA Reasoning API v1 OpenAPI spec | API contract | reference | Leave in place; mention from API docs. | — |

## Runbooks

| Path | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/runbooks/constitution-dogfood-rollout.md` | Constitution Dogfood Rollout | Ops runbook | reference | Keep in place with metadata. | — |
| `docs/runbooks/domain-expansion-runbook.md` | Domain Expansion Runbook | Ops runbook | reference | Keep in place; linked from active domain-expansion doc. | `docs/sophia/domain-expansion.md` |
| `docs/runbooks/gutenberg-groundwork-pilot.md` | Gutenberg Pilot Runbook (Kant Groundwork) | Ops runbook | reference | Keep in place with metadata. | — |
| `docs/runbooks/ingestion-execution-policy.md` | Ingestion Execution Policy | Ops policy | reference | Keep in place with metadata. | — |
| `docs/runbooks/nightly-link-ingestion-runbook.md` | Nightly Link Ingestion Runbook | Ops runbook | reference | Keep in place with metadata. | — |
| `docs/runbooks/vertex-ingestion-cutover-wave2.md` | Vertex Ingestion Cutover Runbook (PoM Wave 2 Cost Validation) | Ops runbook | reference | Keep in place with metadata. | — |
| `docs/runbooks/zuplo-phase1-runbook.md` | Zuplo + PostHog Phase 1 Runbook | Ops runbook | reference | Keep in place with metadata. | — |

## Learn-module docs

| Path | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/Learn Module/daily-drills-pedagogy-v2.md` | SOPHIA Daily Drills v2 Pedagogy Notes | Learn pedagogy | reference | Leave in place with metadata; useful supporting context, but not part of the core active source-of-truth set. | — |
| `docs/Learn Module/learn-pedagogy-framework.md` | SOPHIA Learn Pedagogy Framework | Learn pedagogy | reference | Leave in place with metadata; useful supporting context, but outside the minimal active set. | — |

## Restormel platform docs

These docs are active platform guidance unless marked otherwise. Paths were normalised from `docs/Restormel/...` to `docs/restormel/...`.

| Path at inventory time | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/Restormel/00-overview/00-master-index.md` | Restormel Platform Master Index | Platform docs front door | active | Rewrite with valid repo-relative links; keep as active index. | — |
| `docs/Restormel/01-strategy/01-platform-strategy.md` | Restormel Platform Strategy | Platform strategy | active | Keep as active source of truth. | — |
| `docs/Restormel/01-strategy/02-architectural-modularisation-plan.md` | Restormel Architectural Modularisation Plan | Platform modularisation | active | Keep as active source of truth. | — |
| `docs/Restormel/01-strategy/03-restormel-dev-site-and-sitemap.md` | Restormel.dev Site Strategy and Sitemap | Platform web/product strategy | active | Keep as active source of truth. | — |
| `docs/Restormel/01-strategy/05-brand-identity-and-voice.md` | Restormel Brand Identity and Voice | Brand strategy | active | Keep as active source of truth. | — |
| `docs/Restormel/02-architecture/09-package-boundary-spec.md` | Restormel Package Boundary Specification | Platform architecture | active | Keep as active source of truth. | — |
| `docs/Restormel/02-architecture/10-canonical-schema-spec.md` | Restormel Canonical Schema Specification | Platform architecture | active | Keep as active source of truth. | — |
| `docs/Restormel/02-architecture/14-monorepo-folder-blueprint.md` | Restormel Build Pack 01: Monorepo Folder Blueprint | Platform architecture | active | Keep as active source of truth. | — |
| `docs/Restormel/02-architecture/15-first-extraction-backlog-by-file-module.md` | Restormel Build Pack 02: First Extraction Backlog by File and Module | Platform delivery/architecture | active | Keep as active source of truth. | — |
| `docs/Restormel/02-architecture/17-api-surface-drafts-hosted-graphrag-and-reasoning.md` | Restormel Build Pack 04: API Surface Drafts for Hosted GraphRAG and Reasoning | Platform API architecture | active | Keep as active source of truth. | — |
| `docs/Restormel/03-product/06-site-pages-outline-and-content-requirements.md` | Restormel Site Pages Outline and Content Requirements | Product content plan | active | Keep as active source of truth. | — |
| `docs/Restormel/03-product/11-restormel-graph-mvp-spec.md` | Restormel Graph MVP Specification | Platform product definition | active | Keep as active source of truth. | — |
| `docs/Restormel/03-product/12-graphrag-mvp-spec.md` | Restormel GraphRAG MVP Specification | Platform product definition | active | Keep as active source of truth. | — |
| `docs/Restormel/03-product/13-homepage-wireframe-and-copy-deck.md` | Restormel Homepage Wireframe and Copy Deck | Product/content design | active | Keep as active source of truth. | — |
| `docs/Restormel/03-product/16-restormel-graph-ux-spec.md` | Restormel Build Pack 03: Restormel Graph UX Spec | Product UX | active | Keep as active source of truth. | — |
| `docs/Restormel/04-delivery/07-overarching-implementation-plan.md` | Restormel Platform Overarching Implementation Plan | Delivery | active | Keep as active source of truth. | — |
| `docs/Restormel/04-delivery/08-phased-programmes-of-work.md` | Restormel Platform Phased Programmes of Work | Delivery | active | Keep as active source of truth. | — |
| `docs/Restormel/04-delivery/18-concrete-launch-sequence-restormel-dev.md` | Restormel Build Pack 05: Concrete Launch Sequence for restormel.dev | Delivery | active | Keep as active source of truth. | — |
| `docs/Restormel/04-delivery/19-milestone-plan-with-exit-criteria.md` | Restormel Platform: Milestone Plan with Exit Criteria | Delivery | active | Keep as active source of truth. | — |
| `docs/Restormel/04-delivery/20-engineering-backlog-by-epic.md` | Restormel Platform: Engineering Backlog by Epic | Delivery backlog | active | Keep as active source of truth. | — |
| `docs/Restormel/05-design/21-design-backlog-by-surface.md` | Restormel Platform: Design Backlog by Surface | Design backlog | active | Keep as active source of truth. | — |
| `docs/Restormel/06-marketplace/04-marketplace-strategy.md` | Restormel Marketplace Strategy | Marketplace strategy | active | Keep as active source of truth. | — |
| `docs/Restormel/07-monetisation/22-monetisation-strategies-by-product.md` | Restormel Platform: Monetisation Strategies by Product | Monetisation strategy | active | Keep as active source of truth. | — |
| `docs/Restormel/08-sophia/sophia-repo-assessment.md` | SOPHIA Repo Assessment — Production Grade vs Prototype Grade | Assessment | reference | Keep as supporting assessment context, not an active truth doc. | `docs/sophia/current-state.md` |
| `docs/Restormel/09-adr/README.md` | Architecture Decision Records | ADR process | reference | Keep as supporting reference until ADRs are populated. | — |
| `docs/Restormel/10-reference/23-sophia-documentation-rationalisation-framework.md` | SOPHIA Documentation Rationalisation Framework | Documentation framework | reference | Keep as supporting framework reference. | `docs/sophia/documentation-governance.md` |
| `docs/Restormel/10-reference/README.md` | Reference | Reference index | reference | Keep as supporting reference. | — |
| `docs/Restormel/10-reference/github-linear-automation.md` | Restormel GitHub and Linear Automation Operations | Automation operations | reference | Keep as supporting reference. | — |

## Pre-rationalisation plans and overlapping strategy docs

| Path | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/Plans/argument-map-gold-standard-plan.md` | Argument Map Gold-Standard Plan | Product plan | archived | Move to archive product bucket. | `docs/sophia/roadmap.md` |
| `docs/Plans/argument-native-frontier-overhaul-deferred.md` | Argument-Native Frontier Overhaul (Deferred) | Experimental architecture plan | archived | Move to archive experiments bucket. | `docs/sophia/roadmap.md` |
| `docs/Plans/argument-native-platform-roadmap.md` | Argument-Native Platform Roadmap | Architecture roadmap | archived | Move to archive architecture bucket. | `docs/restormel/01-strategy/02-architectural-modularisation-plan.md` |
| `docs/Plans/byok-end-user-model-selection-plan.md` | BYOK End-User Model Selection Plan | Product/runtime plan | superseded | Move to archive product bucket and mark replaced by active docs. | `docs/sophia/current-state.md` |
| `docs/Plans/byok-rollout-plan.md` | BYOK (Bring Your Own Key) Rollout Plan | Product/runtime plan | superseded | Move to archive product bucket and mark replaced by active docs. | `docs/sophia/current-state.md` |
| `docs/Plans/consumer-monetization-rollout-plan.md` | Consumer Monetization + Legal Hardening Rollout | Product/commercial plan | superseded | Move to archive product bucket and mark replaced by active docs. | `docs/sophia/current-state.md` |
| `docs/Plans/evaluation-methodology.md` | SOPHIA — Evaluation Methodology | Evaluation method | archived | Move to archive experiments bucket; preserve as historical baseline. | `docs/sophia/current-state.md` |
| `docs/Plans/graph-map-simplification-auditability-plan.md` | Graph Map Simplification and Query Auditability Plan | Product plan | archived | Move to archive product bucket. | `docs/sophia/roadmap.md` |
| `docs/Plans/phase1-closeout-baseline-2026-03-12.md` | Phase 1 Closeout Baseline (2026-03-12) | Delivery checkpoint | archived | Move to archive delivery bucket. | — |
| `docs/Plans/phased-resource-expansion-nightly-ingestion-plan.md` | Two-Speed Link Analysis + Nightly Ingestion + Harvard Referencing | Architecture/runtime plan | archived | Move to archive architecture bucket. | `docs/sophia/current-state.md` |
| `docs/Plans/reingestion-cutover-plan.md` | Reingestion Cutover Plan | Delivery plan | archived | Move to archive delivery bucket. | — |
| `docs/Plans/reordered-expansion-plan-gutenberg-step2.md` | Reordered Expansion Plan: Gutenberg Pilot as Step 2 | Delivery plan | archived | Move to archive delivery bucket. | `docs/sophia/domain-expansion.md` |
| `docs/Plans/surrealdb-3-migration-investigation.md` | SurrealDB 3.0 Migration Investigation (SOPHIA) | Architecture investigation | archived | Move to archive architecture bucket. | — |
| `docs/Plans/three-pass-engine.md` | SOPHIA — The Three-Pass Dialectical Engine | Architecture explainer | superseded | Move to archive architecture bucket and point to active architecture doc. | `docs/sophia/architecture.md` |
| `docs/unified-architecture-roadmap.md` | Unified Architecture Roadmap | Architecture roadmap | superseded | Move to archive architecture bucket. | `docs/sophia/architecture.md` |

## Existing archive material reviewed for recategorisation

| Path at inventory time | Title | Topic | Proposed classification | Recommended action | Replacement doc |
| --- | --- | --- | --- | --- | --- |
| `docs/archive/MVP-PIVOT-PLAN.md` | SOPHIA — MVP Pivot Plan (Phase 2) | Historical strategy | archived | Re-home to `docs/archive/strategy/`. | `docs/sophia/product-role.md` |
| `docs/archive/SOPHIA-STRATEGIC-ROADMAP-v2.md` | SOPHIA — Strategic Development Roadmap v2 | Historical strategy | archived | Re-home to `docs/archive/strategy/`. | `docs/sophia/roadmap.md` |
| `docs/archive/CLOUD-DEPLOYMENT.md` | SOPHIA Cloud Deployment Guide | Historical delivery/ops | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/DOCUMENTATION_REORGANIZATION_COMPLETE.md` | Documentation Reorganization Complete | Historical delivery/meta | archived | Re-home to `docs/archive/delivery/`. | `docs/sophia/rationalisation-summary.md` |
| `docs/archive/GCP-ORG-MIGRATION.md` | GCP Project Organization Migration Runbook | Historical delivery/ops | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/MIGRATION-IMPLEMENTATION-SUMMARY.md` | GCP Organization Migration - Implementation Complete | Historical delivery/ops | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/MIGRATION-QUICKSTART.md` | GCP Organization Migration - Quick Reference | Historical delivery/ops | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/ORG-POLICY-TROUBLESHOOTING.md` | GCP Organization Policy Constraints - Troubleshooting | Historical delivery/ops | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/WAVE-1-INGESTION-ANALYSIS.md` | SOPHIA Wave 1 Ingestion Analysis & Optimization Plan | Historical delivery/analysis | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/phase-3a-completion-report.md` | Phase 3a Completion Report | Historical delivery checkpoint | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/phase-3b-checklist.md` | SOPHIA Phase 3b: Checklist & Quality Gates | Historical delivery checkpoint | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/phase-3b-roadmap.md` | SOPHIA Phase 3b Roadmap | Historical delivery checkpoint | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/phase-checklist.md` | SOPHIA Phase 3b: DB Persistence + Ingestion Checklist | Historical delivery checkpoint | archived | Re-home to `docs/archive/delivery/`. | — |
| `docs/archive/graph-visualization-implementation.md` | SOPHIA — Graph Visualization Implementation | Historical product plan | archived | Re-home to `docs/archive/product/`. | `docs/sophia/roadmap.md` |
| `docs/archive/design/MASTER-IMPLEMENTATION-GUIDE.md` | SOPHIA Phase 3c — Master Design Implementation Guide | Historical product/design guide | archived | Re-home to `docs/archive/product/`. | — |
| `docs/archive/design/sophia-design-system-B.md` | SOPHIA Design System | Historical product/design guide | archived | Re-home to `docs/archive/product/`. | — |
| `docs/archive/design/sophia-phase3c-ui-prompt-guide.md` | SOPHIA Phase 3c: UI Implementation — Copilot Prompt Guide | Historical product/design guide | archived | Re-home to `docs/archive/product/`. | — |
| `docs/archive/design/sophia-phases-4-7-prompt-guide.md` | SOPHIA Phases 4–7: Copilot Prompt Guides | Historical product/design guide | archived | Re-home to `docs/archive/product/`. | — |
| `docs/archive/design/sophia-prompts-addendum.md` | SOPHIA Prompts Addendum | Historical product/design guide | archived | Re-home to `docs/archive/product/`. | — |
| `docs/archive/design/SOPHIA-Master-Document.docx` | SOPHIA Master Document | Historical product/design artifact | archived | Re-home to `docs/archive/product/`; binary historical artifact retained for traceability. | — |
| `docs/archive/design/sophia-impl-plan.docx` | SOPHIA implementation plan | Historical product/design artifact | archived | Re-home to `docs/archive/product/`; binary historical artifact retained for traceability. | — |
| `docs/archive/AGENT-IMPLEMENTATION-PROMPT.md` | SOPHIA — Agent Implementation Prompt | Historical prompt artifact | archived | Re-home to `docs/archive/experiments/`. | — |
| `docs/archive/RESUME_FUNCTIONALITY_PROMPT.md` | Fix Resume Functionality in scripts/ingest.ts | Historical prompt artifact | archived | Re-home to `docs/archive/experiments/`. | — |
| `docs/archive/implementation-migration-plan-prompts.md` | SOPHIA — Implementation Migration Plan + Execution Prompts | Historical prompt artifact | archived | Re-home to `docs/archive/experiments/`. | — |
| `docs/archive/prompt-tuning-log.md` | SOPHIA Ingestion Prompt Tuning Log | Historical experiment log | archived | Re-home to `docs/archive/experiments/`. | — |

## Ambiguous items kept out of forced moves

| Path | Reason for ambiguity | Current action |
| --- | --- | --- |
| `docs/Learn Module/*.md` | The repo has an active learn surface, but these docs are more detailed pedagogy references than core product source-of-truth docs. | Keep in place as `reference`; review later if the learn surface gets its own active documentation set. |
| `docs/api-development-portal-roadmap.md` | Still useful as a focused reference plan, but too detailed and specific to remain a top-level active roadmap. | Keep in place as `reference`. |
| `docs/openapi/sophia-v1.yaml` | Non-Markdown reference artifact; important, but not part of the active narrative docs set. | Keep in place as `reference` via surrounding docs. |
