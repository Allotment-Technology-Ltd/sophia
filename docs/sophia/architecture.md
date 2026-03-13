---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Architecture

## Architectural role

SOPHIA is a full-stack showcase application that exercises Restormel-style platform capabilities in one product: graph-grounded reasoning, verification, explanation, BYOK-aware provider handling, billing, and guided learning.

## System shape

```text
Browser UI
  -> SvelteKit app routes and server endpoints
  -> reasoning, verification, BYOK, billing, learn, history, admin, and developer surfaces
  -> SurrealDB argument graph + Firestore account state
  -> provider-backed model/runtime calls and ingestion pipelines
```

## Live architectural layers

### Application layer

- SvelteKit routes power public pages, authenticated app flows, pricing/legal pages, developer/API pages, and the learn surface.
- The same repo serves both consumer-style UX and API endpoints.

### Reasoning layer

- `/api/analyse` orchestrates the main reasoning run.
- The reasoning engine produces structured multi-pass outputs, graph snapshots, retrieval metadata, and verification-related events.
- `/api/verify` and `/api/v1/verify` provide verification-focused flows for product and API use cases.

### Retrieval and graph layer

- SurrealDB stores the claim/relation/argument graph.
- Retrieval is graph-aware and domain-aware for the live showcase domains.
- Graph projection and trace data feed the map/explainability surface.

### Identity, account, and monetisation layer

- Firebase Auth gates user-scoped flows.
- Firestore stores history, BYOK state, billing state, wallet data, entitlements, and related account records.
- Billing and wallet flows sit in the same app because SOPHIA is currently both product and reference implementation.

### Learning layer

- The learn surface reuses shared product infrastructure while adding lesson, review, essay, and progress-specific logic.
- Pedagogy-specific documents remain supporting reference material, not part of the core active source-of-truth set.

### Ingestion and domain-growth layer

- Scripts and runbooks support source curation, fetch, pre-scan, ingestion, review, validation, and domain expansion.
- Current showcase domains are narrower than the available domain taxonomy in code.

## Boundaries

### What belongs in SOPHIA

- Product experience and UX decisions specific to the showcase app
- Reference implementations of platform features in a real app context
- Domain-specific presentation for philosophy reasoning and learning

### What belongs in Restormel

- Platform strategy
- Modularisation and package boundaries
- Reusable platform product definitions
- Cross-product marketplace and monetisation strategy

## Documentation boundary

Use this document for the live SOPHIA architecture only.

Do not use archived architecture plans or old repo-level architecture docs as the current architecture source of truth. When architectural direction changes materially, update this file and the matching Restormel platform docs rather than creating another competing architecture narrative.
