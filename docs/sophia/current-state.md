---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Current State

## Positioning

SOPHIA is no longer documented as a stand-alone product strategy. It is the showcase/reference application for Restormel.

In practice, this repo currently contains both the SOPHIA product surfaces and a substantial amount of emerging platform implementation. The active documentation treats SOPHIA as the product-facing proof surface; platform strategy and extraction plans live in the **maintainer documentation tree** under `docs/local/restormel/` when that pack is present (see [`docs/LOCAL_DOCS.md`](../LOCAL_DOCS.md)).

## What is live in the repo

### Core reasoning surface

- SvelteKit application with authenticated reasoning flows
- Three-pass analysis, critique, and synthesis pipeline
- Verification flows and developer-facing verification API
- Graph snapshot, retrieval trace, and map-oriented explanation primitives
- Firebase-authenticated history and account-scoped usage state

### Knowledge and retrieval layer

- SurrealDB-backed argument graph with typed claims, relations, and arguments
- Active reasoning domains: `ethics` and `philosophy_of_mind`
- Domain selection and heuristic auto-routing for the two live domains
- Ingestion and review workflow infrastructure for broader domain growth
- Broader philosophical domain taxonomy present in types and ingestion tooling, but not yet an active showcase corpus beyond the two live domains

### Platform-style product infrastructure already present in SOPHIA

- BYOK provider storage and validation routes
- Billing, wallet, entitlement, and Paddle checkout flows
- API key management and usage endpoints for `/api/v1/*`
- User-link expansion and deferred/nightly-ingestion hooks in the analyse path
- Harvard-reference enforcement in synthesis and verification prompts/utilities

### Additional product surface

- A Learn experience with lesson, review, and progress routes
- Learning content and pedagogy-specific server logic
- Pricing, privacy, terms, developer, and landing pages that position SOPHIA as a real product rather than a demo-only endpoint

## What is source of truth vs supporting context

- Current product/technical truth: this file and the other **public** docs in `docs/sophia/` (see [Documentation index](../README.md)).
- Active platform truth, operational runbooks, reference library, and archive: `docs/local/` when populated ([`docs/LOCAL_DOCS.md`](../LOCAL_DOCS.md)).

## Current interpretation of the repo

The most strategically aligned interpretation is:

- `Restormel` owns the platform narrative and future modularisation path.
- `SOPHIA` owns the showcase/reference app narrative.
- This repository still contains combined implementation, so some platform capability appears here before extraction.
- When there is conflict between older SOPHIA strategy docs and newer Restormel framing, the Restormel framing wins.

## Active priorities

1. Keep SOPHIA documentation small, current, and aligned to the Restormel platform model.
2. Maintain SOPHIA as a convincing reference application across reasoning, API, and learning surfaces.
3. Continue domain growth with explicit status and promotion criteria rather than parallel undocumented expansions.
4. Extract reusable platform concerns into Restormel over time without letting SOPHIA documentation drift into a second competing platform plan.
5. Preserve historical material for traceability, but keep it out of the active instructional surface.

## Cautions

- Not every feature present in code should be treated as a product-commitment surface.
- Older root-level roadmap/status/architecture documents are no longer authoritative.
- Detailed archived plans may still be useful context, but they should not override the active docs set.
