---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Platform Phased Programmes of Work

## Purpose
This document breaks the implementation journey into delivery phases and parallel programmes of work, moving from the current state to a live Restormel platform.

---

## Delivery model

The work should run as a set of parallel programmes rather than a single linear backlog.

### Programme A
Platform and package extraction

### Programme B
Restormel Graph product build

### Programme C
Restormel.dev site, docs, and playground

### Programme D
Console, auth, provider config, and operations

### Programme E
SOPHIA migration into shared modules

### Programme F
Commercial and marketplace readiness

---

## Phase 0: Foundation planning

### Objectives
- align strategy
- lock naming
- define package set
- define core product hierarchy
- define site information architecture
- define brand direction

### Outputs
- strategy pack
- package map
- site map
- brand and voice baseline
- initial implementation plan

### Exit criteria
- agreement on Restormel as platform brand
- agreement on SOPHIA as reference app
- agreement on first wedge product

---

## Phase 1: Contract and boundary definition

### Objectives
- define shared contracts
- define package ownership
- design monorepo structure
- specify extraction order

### Programme A work
- graph schema
- reasoning trace schema
- retrieval trace schema
- package exports map
- dependency rules

### Programme E work
- identify current SOPHIA code ownership by future package
- mark code that stays app-specific

### Outputs
- package boundary spec
- canonical schema spec
- file move plan
- import migration guide

### Exit criteria
- no unresolved ambiguity around schema ownership
- extraction plan is implementable without full rewrite

---

## Phase 2: Core extraction

### Objectives
- extract minimum viable shared platform packages
- keep SOPHIA working while modularization begins

### Programme A work
- create `@restormel/contracts`
- create `@restormel/graph-core`
- create `@restormel/observability`
- set up package build and internal versioning

### Programme E work
- update SOPHIA imports to shared packages
- verify parity

### Outputs
- first shared packages live in monorepo
- SOPHIA consuming extracted modules

### Exit criteria
- shared contracts compile and are used in app paths
- graph and trace logic reusable outside SOPHIA

---

## Phase 3: Restormel Graph MVP

### Objectives
- ship first visible product
- validate visual debugging wedge

### Programme B work
- graph canvas
- trace timeline
- node inspector
- filters
- answer-path highlight
- import from JSON/trace

### Programme C work
- homepage MVP
- Graph product page
- playground shell
- docs shell

### Programme D work
- simple auth path
- project save capability
- upload persistence baseline

### Outputs
- Restormel Graph alpha
- public playground
- first docs and screenshots

### Exit criteria
- a new user can upload a trace and understand the graph
- shareable demo experience exists

---

## Phase 4: GraphRAG MVP

### Objectives
- productize retrieval layer
- connect retrieval outputs to Restormel Graph

### Programme A work
- create `@restormel/graphrag-core`
- extract hybrid retrieval
- extract seed-set and expansion logic

### Programme B work
- GraphRAG visual overlays and trace support

### Programme C work
- GraphRAG product page
- GraphRAG docs and examples
- playground GraphRAG tab

### Programme D work
- API endpoints
- job/run storage
- API key support if hosted

### Programme E work
- SOPHIA retrieval path switched to shared GraphRAG core where possible

### Outputs
- GraphRAG beta
- retrieval trace view in Restormel
- sample corpus demo

### Exit criteria
- user can ingest sample docs, run query, inspect graph-backed retrieval trace

---

## Phase 5: Hosted platform baseline

### Objectives
- make the platform properly self-serve
- establish a usable control plane

### Programme C work
- pricing page
- templates page
- onboarding flows

### Programme D work
- console MVP
- API keys
- provider settings
- projects
- usage and billing baseline

### Programme B work
- save / reload traces
- basic collaboration-ready data model

### Outputs
- usable Restormel console
- self-serve project creation
- basic hosted API surface

### Exit criteria
- a user can sign up, create a project, configure provider settings, and run a first workflow without manual intervention

---

## Phase 6: Reasoning and BYOK productization

### Objectives
- expose more of the platform stack as products
- widen adoption beyond visual debugging

### Programme A work
- create `@restormel/reasoning-core`
- create `@restormel/providers`

### Programme C work
- Reasoning page
- BYOK page
- docs and examples

### Programme D work
- hosted Reasoning API baseline
- provider validation and model controls

### Programme E work
- move SOPHIA onto shared reasoning/provider modules

### Outputs
- Reasoning API preview
- BYOK foundations live

### Exit criteria
- reasoning pipeline can be consumed outside SOPHIA through stable contracts

---

## Phase 7: Commercial readiness and marketplaces

### Objectives
- prepare one clear hosted SKU
- establish procurement and trust surfaces

### Programme F work
- hosted SKU definition
- marketplace collateral
- security page
- support process
- entitlement and fulfillment flows

### Programme C work
- marketplace page
- procurement CTA

### Programme D work
- subscription and entitlement handling

### Outputs
- marketplace-ready package
- AWS-first submission readiness
- Microsoft and Google follow-on path

### Exit criteria
- one hosted Restormel product is operationally ready for marketplace submission

---

## Recommended parallelization now

### Parallel track 1
**Architecture track**
- package boundary spec
- canonical schemas
- monorepo structure

### Parallel track 2
**Product wedge track**
- Restormel Graph MVP spec
- graph UX and visual language
- playground flows

### Parallel track 3
**Brand and site track**
- design system
- homepage wireframe
- docs IA
- core product pages

### Parallel track 4
**Operations track**
- auth and projects model
- API key model
- provider configuration model

These can all move at once.

---

## Critical path

If forced to simplify, the critical path is:
1. package boundaries
2. canonical schemas
3. graph-core extraction
4. observability extraction
5. Restormel Graph playground
6. homepage + docs shell
7. GraphRAG extraction
8. console baseline

---

## Suggested planning artifacts still needed

1. package boundary spec
2. schema spec
3. Restormel Graph MVP product spec
4. GraphRAG MVP product spec
5. homepage wireframe and copy deck
6. console IA and flows
7. marketplace readiness checklist
