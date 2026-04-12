---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Product Role

## Core definition

SOPHIA is the showcase and reference application for Restormel.

It is not the parent platform brand. It is the application that demonstrates what the platform can do in a concrete domain.

## SOPHIA's jobs

### 1. Showcase app

SOPHIA should make Restormel capabilities legible in product form:
- graph-grounded reasoning
- verification and citation discipline
- retrieval explainability and map surfaces
- BYOK and billing flows
- API and developer-facing integration surfaces

### 2. Reference implementation

SOPHIA is where platform capabilities can be exercised end to end before or while they are extracted into reusable Restormel modules.

### 3. Dogfooding environment

If a capability is meant to become part of Restormel, SOPHIA is an acceptable place to validate it first, as long as the documentation stays clear about what is product-facing, what is experimental, and what is platform-bound.

### 4. Domain experience layer

SOPHIA is responsible for the philosophy-specific user experience: queries, pedagogy, learning workflows, and domain framing.

## What SOPHIA is not

- not the platform strategy source of truth
- not the place to maintain a second competing platform roadmap
- not the canonical home for reusable package boundaries or ecosystem-wide monetisation policy

Those belong in the Restormel doc pack under `docs/local/restormel/` when the maintainer tree is present ([`docs/LOCAL_DOCS.md`](../LOCAL_DOCS.md)).

## Practical operating rule

When a feature or document answers one of these questions, it probably belongs in SOPHIA docs:
- How does the showcase app currently work?
- What is live for SOPHIA users or developers?
- How does the philosophy-specific experience behave?

When it answers one of these, it probably belongs in Restormel docs:
- What is the reusable platform strategy?
- What should be extracted into packages/services?
- How do multiple future products fit together?
