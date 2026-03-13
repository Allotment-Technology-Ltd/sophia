# Restormel Platform Overarching Implementation Plan

## Purpose
This document defines the high-level implementation plan for moving from the current SOPHIA-centric codebase to a live Restormel platform with modular packages, a self-serve developer site, and a first hosted product surface.

---

## Strategic outcome

Build a live Restormel platform where:
- reusable platform modules exist as clear packages
- SOPHIA consumes those modules as the showcase app
- restormel.dev serves as homepage, docs hub, playground, and console
- Restormel Graph is the first public wedge product
- GraphRAG becomes the second productized capability

---

## Delivery goals

### Goal 1
Define stable contracts and package boundaries.

### Goal 2
Extract the first reusable platform modules from SOPHIA.

### Goal 3
Ship Restormel Graph as the first public self-serve product.

### Goal 4
Ship GraphRAG as the second public product.

### Goal 5
Refactor SOPHIA into the reference app rather than the source of truth.

### Goal 6
Lay the operational foundations for future marketplace distribution.

---

## Guiding implementation principles

1. extract before rewriting
2. stabilize contracts early
3. keep one monorepo at first
4. prioritize visible wedge value
5. make self-serve the default motion
6. keep hosted products and package exports aligned

---

## Implementation streams

### Stream A: Platform architecture
Work:
- define canonical contracts
- package extraction
- repo restructuring
- dependency and import cleanup

### Stream B: Product development
Work:
- Restormel Graph MVP
- GraphRAG MVP
- shared UI primitives
- console shell

### Stream C: Site and growth surface
Work:
- homepage
- docs
- playground
- templates
- pricing
- brand rollout

### Stream D: Platform operations
Work:
- auth
- project/account model
- API key handling
- provider config
- usage and billing foundations

### Stream E: Commercial readiness
Work:
- packaging
- security and trust docs
- marketplace preparation
- support model

---

## Target architecture end state

### Apps
- `apps/sophia`
- `apps/restormel-site`
- `apps/restormel-console`
- `apps/restormel-api`

### Packages
- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/graphrag-core`
- `@restormel/reasoning-core`
- `@restormel/providers`
- `@restormel/observability`
- `@restormel/sdk`
- `@restormel/ui`

---

## Implementation sequence

### Step 1: planning baseline
Outputs:
- strategy pack
- package map
- canonical contracts draft
- site map
- brand direction

### Step 2: package boundary definition
Outputs:
- exact file move plan
- import strategy
- shared schema ownership
- build and release strategy

### Step 3: contracts extraction
Outputs:
- `@restormel/contracts`
- graph, reasoning, and retrieval schemas
- validators and type exports

### Step 4: graph and observability extraction
Outputs:
- `@restormel/graph-core`
- `@restormel/observability`
- reusable graph projection and trace shaping

### Step 5: Restormel Graph MVP
Outputs:
- graph viewer
- trace viewer
- inspector
- answer-path highlighting
- import flow on playground

### Step 6: site and docs MVP
Outputs:
- homepage
- Graph product page
- docs shell
- playground
- pricing
- about page

### Step 7: GraphRAG extraction and MVP
Outputs:
- `@restormel/graphrag-core`
- ingest + retrieve flow
- retrieval trace
- GraphRAG docs and examples

### Step 8: console and hosted service baseline
Outputs:
- accounts/projects
- API keys
- provider settings
- saved traces
- first hosted endpoints

### Step 9: SOPHIA migration
Outputs:
- SOPHIA consuming shared packages
- reduced bespoke platform logic in SOPHIA
- showcase integration with Restormel views

### Step 10: marketplace readiness
Outputs:
- hosted SKU definition
- entitlement and onboarding flow
- trust docs and procurement pages

---

## What to ship first publicly

### First public release
**Restormel Graph alpha**

Why:
- easiest to understand
- easiest to demo
- improves SOPHIA immediately
- strongest hook for developers and vibe coders

### Second public release
**Restormel GraphRAG beta**

Why:
- differentiated capability
- clear link to visual debugging
- stronger platform story

### Third public release
**Reasoning API preview**

Why:
- more powerful after platform trust is established
- stronger once GraphRAG and observability are already visible

---

## Success criteria by stage

### Architecture success
- shared packages adopted in app code
- stable contracts used across products
- clean internal dependency boundaries

### Product success
- user can reach a magic moment in under 2 minutes
- graph and trace import works reliably
- playground demonstrates clear value

### Platform success
- users can sign up, create keys, and run first workflows self-serve
- docs and templates reduce onboarding friction

### Commercial success
- one hosted SKU is clearly packageable for marketplace listing

---

## Key dependencies

### Technical dependencies
- stable schema design
- package build setup
- auth and account model
- provider abstraction discipline
- graph rendering performance

### Product dependencies
- clear homepage and product positioning
- usable playground
- docs quality
- consistent brand rollout

### Operational dependencies
- billing model
- support path
- environment management
- trust and security documentation

---

## Immediate next planning outputs needed

1. package boundary spec
2. canonical schema spec
3. Restormel Graph MVP spec
4. Restormel.dev wireframes
5. phased programme plan with owners and parallel workstreams
