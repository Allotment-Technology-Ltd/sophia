---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Marketplace Strategy

## Status
Draft v1 focused on cloud marketplace sequencing and readiness.

## Purpose
Use cloud marketplaces as procurement, trust, and enterprise distribution channels for Restormel hosted products.

Marketplace listings should not be treated as the first user acquisition channel. They should come after the self-serve product, console, identity, entitlement, and onboarding model are working well enough to support repeatable external adoption.

## Strategic role of marketplaces
Cloud marketplaces provide:
- easier procurement for enterprise buyers
- stronger trust signals
- co-sell and partner-distribution opportunities
- alignment with cloud budgets and procurement processes

They do not replace:
- product-led adoption
- self-serve onboarding
- docs and developer experience
- good packaging of SKUs

## Marketplace-first principle
Do not list raw platform packages first.

The first marketplace offer should be a hosted, easy-to-understand SKU with visible business value.

## Recommended first SKU
**Restormel GraphRAG Platform**

Suggested bundle:
- hosted GraphRAG retrieval
- visual trace debugger
- project-based console
- optional provider-flexible / BYOK configuration

Why this first:
- clearer value than low-level packages
- easier to explain to buyers
- combines API utility with visual UI
- stronger enterprise story than “contracts” or “observability”

## Recommended sequence

### 1. AWS Marketplace first
Rationale:
- strong SaaS distribution path
- broad enterprise familiarity
- relatively flexible for hosted software offers
- good fit for initial procurement expansion

Use this once:
- self-serve onboarding is stable
- entitlement and subscription handling are implemented
- architecture and support docs are ready

### 2. Microsoft commercial marketplace second
Rationale:
- good fit for enterprise software procurement
- useful for lead-gen even before full transactable SaaS maturity
- Microsoft ecosystem relevance for many technical buyers

Potential staged approach:
- initial lead-gen listing
- later transactable SaaS offer

### 3. Google Cloud Marketplace third
Rationale:
- attractive if the hosted product aligns well with GCP-native deployment and procurement
- strongest once the hosted platform story is mature and production-ready

## Marketplace readiness checklist
Before marketplace submission, Restormel should have:

### Product readiness
- one clear hosted SKU
- documented onboarding flow
- stable pricing model
- production-ready support path
- customer-facing status/trust information

### Technical readiness
- entitlement and subscription handling
- authentication and project creation flow
- API key lifecycle
- fulfillment landing page / onboarding path
- usage metering strategy if usage-based
- architecture diagram

### Commercial readiness
- terms and privacy policy
- support SLAs / support contact model
- packaging and pricing dimensions
- marketplace-specific product descriptions
- demo or screenshots

### Security / trust readiness
- security overview page
- data handling statement
- provider/BYOK explanation
- logging and retention policy summary
- operational support process

## Suggested product packaging for marketplaces

### SKU 1: Restormel GraphRAG Platform
For:
- AI teams building graph-aware retrieval products

Includes:
- hosted GraphRAG API
- visual trace debugging
- console project management
- API keys
- docs and templates

### SKU 2: Restormel Reasoning API
Later stage.

For:
- teams needing structured multi-pass reasoning and inspectable traces

### SKU 3: Restormel Enterprise BYOK
Later stage.

For:
- enterprises that want provider flexibility and tighter governance

## Procurement path by maturity stage

### Stage 1: self-serve only
`restormel.dev` handles:
- signup
- playground
- console
- docs
- direct billing

### Stage 2: marketplace-assisted procurement
Restormel supports:
- direct self-serve
- AWS Marketplace procurement for hosted SKU

### Stage 3: multi-marketplace procurement
Restormel supports:
- direct billing
- AWS
- Microsoft
- Google Cloud

## Marketplace landing architecture
The site should include:
- `/marketplace`
- `/marketplace/aws`
- `/marketplace/azure`
- `/marketplace/gcp`

Each page should explain:
- what product is available
- who it is for
- how entitlement/onboarding works
- support model
- links to listing when live

## Marketplace messaging principles
Keep the messaging practical.

Emphasize:
- graph-native retrieval
- visual debugging
- traceability
- provider flexibility
- self-serve onboarding with enterprise purchase paths

Avoid leading with:
- internal architecture jargon
- overly philosophical language
- low-level package names

## Internal preparation workstreams

### Workstream 1: packaging
Define the exact product SKU, pricing model, and included features.

### Workstream 2: entitlement
Implement subscription and entitlement handling that can work across direct and marketplace channels.

### Workstream 3: onboarding
Ensure a buyer can land from marketplace purchase into a clean project creation and setup flow.

### Workstream 4: trust
Prepare security, compliance, privacy, support, and architecture materials.

### Workstream 5: GTM
Write listing copy, screenshots, demo paths, and sales-support assets.

## Recommended sequence of action
1. launch Restormel self-serve on `restormel.dev`
2. establish one hosted product SKU
3. standardize auth, entitlement, onboarding, and billing
4. prepare marketplace materials
5. list on AWS first
6. expand to Microsoft
7. expand to Google Cloud once deployment and procurement story are stronger

## Risks

### Risk 1: listing too early
If the product is not self-serve ready, marketplace traffic will convert poorly and create support burden.

### Risk 2: too many SKUs
Too many options too early will confuse buyers and complicate listing management.

### Risk 3: procurement before clarity
If pricing, entitlement, or onboarding are unclear, marketplace readiness will stall.

## Success measures
- marketplace approval
- procurement-generated accounts
- time from subscription to first successful run
- conversion from marketplace lead to active project
- enterprise support burden vs revenue

## One-sentence strategy
Use marketplaces to make Restormel easier for enterprises to buy after the self-serve platform is stable, starting with one clear hosted GraphRAG-focused SKU and expanding only once onboarding and entitlement are production-ready.
