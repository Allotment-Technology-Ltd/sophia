# SOPHIA — Documentation Index

---

## Core references

| Document | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | System diagram, components, SSE contract, deployment, design decisions |
| [argument-graph.md](argument-graph.md) | SurrealDB schema reference — tables, relation types, SurrealQL examples |
| [three-pass-engine.md](three-pass-engine.md) | Engine rationale, per-pass contract, example output |
| [evaluation-methodology.md](evaluation-methodology.md) | Evaluation rubric, Phase 1 results, limitations, planned formal study |
| [accessibility-rules.md](accessibility-rules.md) | UI accessibility baseline: contrast, card heading readability, and control/focus rules |
| [prompts-reference.md](prompts-reference.md) | All LLM prompt templates, organised by pass |
| [references/essay-writing-basics-summary.md](references/essay-writing-basics-summary.md) | North-star academic writing rubric distilled from *The Basics of Essay Writing* and applied to all three passes |
| [api-development-portal-roadmap.md](api-development-portal-roadmap.md) | Phased API developer portal roadmap (MVP → Gold-Plated) |
| [phased-resource-expansion-nightly-ingestion-plan.md](phased-resource-expansion-nightly-ingestion-plan.md) | Proposed phased plan: fast runtime link intake + nightly full ingestion + Harvard references |

## Operations

| Document | Purpose |
| --- | --- |
| [runbooks/domain-expansion-runbook.md](runbooks/domain-expansion-runbook.md) | End-to-end guide for adding a new philosophical domain |
| [runbooks/vertex-ingestion-cutover-wave2.md](runbooks/vertex-ingestion-cutover-wave2.md) | Operational runbook for Vertex ingestion cutover validation using PoM Wave 2 cost comparison vs PoM Wave 1 |
| [runbooks/zuplo-phase1-runbook.md](runbooks/zuplo-phase1-runbook.md) | Phase 1 setup for Zuplo gateway + PostHog analytics |
| [runbooks/nightly-link-ingestion-runbook.md](runbooks/nightly-link-ingestion-runbook.md) | Proposed operations guide for nightly deferred link ingestion |

## API Contracts

| Document | Purpose |
| --- | --- |
| [openapi/sophia-v1.yaml](openapi/sophia-v1.yaml) | OpenAPI 3.1 contract for `POST /api/v1/verify` (Zuplo import) |

## Planning and Strategy

| Document | Purpose |
| --- | --- |
| [byok-rollout-plan.md](byok-rollout-plan.md) | Canonical BYOK (Bring Your Own Key) rollout plan: Phase 1, Phase 1b, Phase 1c, and deferred Phase 2 monetization |
| [consumer-monetization-rollout-plan.md](consumer-monetization-rollout-plan.md) | Consumer monetization + legal hardening implementation plan (Paddle billing, BYOK metering, entitlements, and legal rollout controls) |
| [argument-map-gold-standard-plan.md](argument-map-gold-standard-plan.md) | Gold-standard delivery plan for the Phase 9 argument map experience |

## Archive

`docs/archive/` contains historical planning documents, completed-phase checklists, implementation guides, and internal operational notes from earlier phases. These are kept for reference but are not maintained.

---

## Root-level documents

| Document | Purpose |
| --- | --- |
| [ROADMAP.md](../ROADMAP.md) | Development phases and priorities |
| [STATUS.md](../STATUS.md) | Deployment health and feature status |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute |
| [CHANGELOG.md](../CHANGELOG.md) | Version history |
