---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel.dev Site Strategy and Sitemap

## Status
Draft v1 for the public-facing Restormel domain.

## Domain role
`restormel.dev` should not be just a marketing site.

It should act as the primary operating surface for the Restormel platform by serving four functions:
- product homepage
- documentation hub
- self-serve playground
- authenticated developer console entry point

## Primary objective
Make `restormel.dev` the easiest place on the internet to go from opaque AI output to visible, explorable reasoning and graph-native AI tooling.

## Audience design
The site must serve three levels of user maturity.

### 1. Curious visitor
Questions:
- what is this?
- why does it matter?
- can I try it now?

Needs:
- clear value proposition
- visual demo
- immediate self-serve CTA

### 2. Evaluating developer
Questions:
- how does it work?
- what packages exist?
- how do I install it?
- what is the API shape?

Needs:
- docs
- quickstarts
- examples
- schemas
- package pages
- API references

### 3. Technical buyer / team lead
Questions:
- is this secure?
- how is it deployed?
- what is the procurement path?
- is BYOK supported?
- can I buy it through cloud marketplaces?

Needs:
- architecture pages
- pricing
- support / trust pages
- deployment options
- marketplace information

## Core site principle
**Simple on the surface, deep underneath.**

The site must work for both technical professionals and novice vibe coders without splitting the product into two disconnected experiences.

## Site goals
1. explain the platform clearly
2. let users try something immediately
3. route users to the right product surface
4. support self-serve signup and project creation
5. support later procurement and enterprise trust

## Global navigation
Recommended top-level nav:
- Products
- Playground
- Docs
- Templates
- Pricing
- Console

## Sitemap

### `/`
Homepage

Purpose:
- introduce Restormel
- explain core platform value
- route users to products
- offer instant hands-on trial

### `/products`
Platform overview

Sub-pages:
- `/products/graph`
- `/products/graphrag`
- `/products/reasoning`
- `/products/byok`

### `/playground`
Interactive trial surface

Purpose:
- let users try Restormel without commitment
- showcase graph visualisation, traces, and answer paths

Potential sub-tools:
- `/playground/graph`
- `/playground/graphrag`
- `/playground/reasoning`

### `/docs`
Developer documentation hub

Sub-sections:
- `/docs/quickstart`
- `/docs/concepts`
- `/docs/packages`
- `/docs/api`
- `/docs/schemas`
- `/docs/examples`
- `/docs/deployments`
- `/docs/marketplace`

### `/templates`
Starter kits and examples

Potential categories:
- Graph visualisation starter
- GraphRAG starter
- BYOK embed starter
- Svelte/Next.js templates
- novice builder templates

### `/pricing`
Pricing and plan comparison

Should cover:
- free/community
- developer
- team
- enterprise
- marketplace procurement note

### `/console`
Authenticated control plane

Functions:
- projects
- API keys
- provider settings
- trace history
- uploads
- usage and billing
- saved playground runs

### `/marketplace`
Cloud marketplace and procurement page

Purpose:
- explain AWS, Azure/Microsoft, and Google Cloud purchase paths
- help buyers understand which SKU(s) are available where

### `/changelog`
Public release notes

### `/blog`
Technical writing, demos, product launches, deep dives

### `/security`
Trust and security overview

### `/about`
Optional lightweight company/platform story page

## Homepage wireframe intent

### Section 1: hero
Headline:
Graph-native developer tools for explainable AI systems.

Subhead:
Visualize, debug, and ship GraphRAG, reasoning, and provider-flexible AI workflows.

Primary CTA:
Open Playground

Secondary CTA:
Read Docs

### Section 2: product cards
Cards for:
- Restormel Graph
- Restormel GraphRAG
- Restormel Reasoning
- Restormel BYOK

Each card should include:
- one-line job to be done
- primary output
- audience fit
- link to product page

### Section 3: show-me demo
Live or semi-live interactive example:
- paste trace
- see graph appear
- highlight answer path

This is the platform’s “magic moment.”

### Section 4: audience lanes
Two simple entry points:
- For developers
- For builders

The language difference should be about usage style, not product quality.

### Section 5: package + API strip
Show packages and APIs clearly:
- npm packages
- hosted endpoints
- SDKs
- UI components

### Section 6: proof and trust
Include:
- architecture highlights
- provider flexibility
- marketplace plan / enterprise readiness
- reference app: SOPHIA

### Section 7: closing CTA
Primary:
Start in the Playground
Secondary:
Create a Project

## Self-serve experience strategy

### Novice builder flow
1. land on homepage
2. go to playground
3. upload trace or paste JSON
4. see graph instantly
5. choose “turn this into a project”
6. create account
7. receive starter template or embed snippet

### Technical developer flow
1. land on docs or product page
2. copy install command
3. run quickstart
4. call API or SDK
5. inspect result in visualizer
6. create project / API key if needed

Both flows should converge on the console.

## Console information architecture

### MVP console surfaces
- projects
- API keys
- provider settings
- trace uploads
- saved runs
- usage
- billing

### Later console surfaces
- org/team management
- marketplace subscription status
- deployment connectors
- webhooks
- advanced observability settings

## Docs strategy
Docs must support both conceptual understanding and fast execution.

Recommended docs structure:
- getting started in five minutes
- GraphDocument schema
- retrieval trace schema
- reasoning event schema
- package quickstarts
- API reference
- integrations
- deployment and marketplace guides

## Content strategy for different users

### For pros
Focus on:
- schema clarity
- package structure
- API reference
- composability
- deployment

### For vibe coders
Focus on:
- visual demos
- templates
- hosted flows
- copy-paste setup
- simple wording

## Key product hooks on the site

### Hook 1: Visualize your chatbot trace
Paste or upload a trace and see the answer path.

### Hook 2: Turn your docs into a graph-backed AI endpoint
Upload docs, ask a question, inspect the retrieval graph.

### Hook 3: Add BYOK AI to your app in minutes
Generate starter code or an embed snippet.

## Design implication
The site should feel:
- immediately useful
- visually intelligent
- not overly corporate
- credible to developers
- approachable to solo builders

## MVP site build order
1. homepage
2. docs shell
3. playground for graph + trace import
4. product pages
5. pricing
6. console shell
7. templates
8. marketplace page

## Success indicators
- homepage to playground click-through
- playground completion rate
- docs quickstart completion rate
- project creation rate
- API key generation rate
- return visits to console

## One-sentence site strategy
Use `restormel.dev` as the single front door where users can understand the platform, try it instantly, learn it quickly, and grow into a full self-serve developer or team workflow.
