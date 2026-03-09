# SOPHIA — Documentation Index

---

## Core references

| Document | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | System diagram, components, SSE contract, deployment, design decisions |
| [argument-graph.md](argument-graph.md) | SurrealDB schema reference — tables, relation types, SurrealQL examples |
| [three-pass-engine.md](three-pass-engine.md) | Engine rationale, per-pass contract, example output |
| [evaluation-methodology.md](evaluation-methodology.md) | Evaluation rubric, Phase 1 results, limitations, planned formal study |
| [prompts-reference.md](prompts-reference.md) | All LLM prompt templates, organised by pass |
| [api-development-portal-roadmap.md](api-development-portal-roadmap.md) | Phased API developer portal roadmap (MVP → Gold-Plated) |
| [phased-resource-expansion-nightly-ingestion-plan.md](phased-resource-expansion-nightly-ingestion-plan.md) | Proposed phased plan: fast runtime link intake + nightly full ingestion + Harvard references |

## Operations

| Document | Purpose |
| --- | --- |
| [runbooks/domain-expansion-runbook.md](runbooks/domain-expansion-runbook.md) | End-to-end guide for adding a new philosophical domain |
| [runbooks/zuplo-phase1-runbook.md](runbooks/zuplo-phase1-runbook.md) | Phase 1 setup for Zuplo gateway + PostHog analytics |
| [runbooks/nightly-link-ingestion-runbook.md](runbooks/nightly-link-ingestion-runbook.md) | Proposed operations guide for nightly deferred link ingestion |

## API Contracts

| Document | Purpose |
| --- | --- |
| [openapi/sophia-v1.yaml](openapi/sophia-v1.yaml) | OpenAPI 3.1 contract for `POST /api/v1/verify` (Zuplo import) |

## Planning and Strategy

| Document | Purpose |
| --- | --- |
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
