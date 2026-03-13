---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Site Pages Outline and Content Requirements

## Purpose
This document defines the core pages for restormel.dev, their strategic role, page structure, and content requirements.

Restormel.dev should function as:
- product homepage
- documentation hub
- self-serve playground
- authenticated platform console
- procurement and trust surface

---

## Site goals

The site must help users:
1. understand what Restormel is
2. try a useful capability immediately
3. evaluate products and APIs
4. adopt via docs or console
5. trust the platform operationally
6. procure through standard routes later

---

## Primary audience lanes

### Lane 1: Developers
Needs:
- quick explanation
- install path
- examples
- API docs
- schemas

### Lane 2: Builders / vibe coders
Needs:
- playground
- templates
- copy-paste snippets
- hosted entry points
- low-friction setup

### Lane 3: Technical buyers / teams
Needs:
- product overview
- security posture
- deployment and provider model
- pricing
- marketplace and procurement path

---

## Core site map

- `/`
- `/products`
- `/graph`
- `/graphrag`
- `/reasoning`
- `/byok`
- `/playground`
- `/docs`
- `/templates`
- `/pricing`
- `/console`
- `/marketplace`
- `/security`
- `/changelog`
- `/blog`
- `/about`

---

## Homepage `/`

### Strategic role
Primary entry point for brand, value proposition, and self-serve exploration.

### Core message
**Graph-native developer tools for explainable AI systems.**

### Primary CTA
**Open Playground**

### Secondary CTA
**Read Docs**

### Outline
1. Hero
2. Product family overview
3. Interactive demo / magic moment
4. Use-case lanes
5. Product detail strips
6. How it works
7. Developer adoption proof points
8. Security / provider flexibility / deployment strip
9. Final CTA

### Content requirements

#### Hero
- one clear headline
- one concise supporting sentence
- two CTAs
- product screenshot or animated graph visual

#### Product family overview
- cards for Graph, GraphRAG, Reasoning, BYOK
- one-line summary for each
- route to deeper page

#### Interactive demo section
- paste or upload trace / graph
- visual graph response
- explainable answer path highlight

#### Use-case lanes
- for developers
- for builders
- for teams

#### Final CTA
- open playground
- sign in to console

---

## Products page `/products`

### Strategic role
Overview of the full suite.

### Content requirements
- ecosystem diagram
- four product cards
- explanation of how they fit together
- SOPHIA as showcase reference
- comparison by use case and user type

---

## Graph product page `/graph`

### Strategic role
Landing page for visual debugging product.

### Core message
Visual debugger for graphs, traces, and answer paths.

### Content requirements
- product intro
- why typical graph tooling is hard
- what Restormel Graph makes easy
- screenshots of graph view, pipeline view, inspector, trace timeline
- supported input types
- example flow from trace upload to insight
- link to playground
- link to docs

### Proof section
Show before and after:
- raw trace JSON
- graph visualized with answer path

---

## GraphRAG page `/graphrag`

### Strategic role
Landing page for the retrieval engine.

### Core message
Plug-and-play graph-native retrieval for AI apps.

### Content requirements
- explanation of GraphRAG vs vector-only RAG
- simple architecture diagram
- example ingest → retrieve → graph → context pack flow
- developer quickstart snippet
- trace + Restormel visualization integration
- deployment options

---

## Reasoning page `/reasoning`

### Strategic role
Landing page for structured reasoning APIs.

### Core message
Structured multi-pass reasoning as an API.

### Content requirements
- explain the pass model simply
- input/output example
- stream events example
- how graph context improves reasoning
- supported providers
- safety and inspectability angle

---

## BYOK page `/byok`

### Strategic role
Landing page for provider-flexible embedding and model control.

### Core message
Bring-your-own-key AI infrastructure for your app.

### Content requirements
- explain BYOK value simply
- provider options
- model routing concept
- tenant/project controls
- sample embed or SDK snippet
- security and spend-control notes

---

## Playground `/playground`

### Strategic role
Main self-serve activation surface.

### Must-do outcomes
A user should be able to:
- paste graph JSON
- upload a trace
- ask a GraphRAG question against a sample corpus
- see output instantly
- save or continue in console

### Content and feature requirements
- tabs for Graph, Trace, GraphRAG, Reasoning demos
- sample datasets and sample traces
- import panel
- graph canvas
- inspector
- timeline
- CTA to save project or create account

This is the key hook page for both technical and novice users.

---

## Docs `/docs`

### Strategic role
Reference and adoption hub.

### Information architecture
- Quickstart
- Concepts
- Packages
- API reference
- Schemas
- Examples
- Deployments
- Marketplace
- Changelog

### Content requirements
- fast getting-started path
- package-specific pages
- schema definitions
- examples with copy-paste code
- architecture diagrams
- hosted vs self-hosted guidance

---

## Templates `/templates`

### Strategic role
Reduce setup friction for novice builders and fast-moving devs.

### Content requirements
- starter templates by framework
- example apps
- embed examples
- GraphRAG quickstart projects
- reasoning API sample apps
- importable sample traces

---

## Pricing `/pricing`

### Strategic role
Clarify free, developer, team, and future enterprise paths.

### Content requirements
- free tier / playground access
- hosted API pricing assumptions
- team features later
- BYOK positioning
- marketplace note for enterprise procurement

Pricing page should stay simple initially.

---

## Console `/console`

### Strategic role
Authenticated control plane.

### Initial feature requirements
- projects
- API keys
- provider settings
- playground saves
- trace history
- usage
- billing

### Later feature requirements
- org settings
- team access
- deployment connectors
- marketplace subscriptions

---

## Marketplace `/marketplace`

### Strategic role
Commercial and procurement surface.

### Content requirements
- current marketplace availability
- deployment and fulfillment overview
- trust and support notes
- links to AWS, Microsoft, and Google listings when live
- procurement CTA

---

## Security `/security`

### Strategic role
Trust surface for buyers and serious adopters.

### Content requirements
- provider model summary
- BYOK posture
- data handling overview
- environment isolation assumptions
- support contact
- future certifications roadmap if applicable

---

## Blog `/blog`

### Strategic role
Narrative and discovery engine.

### Content requirements
- product updates
- technical explainers
- graph visualisation demos
- GraphRAG thinking
- SOPHIA showcase stories

---

## About `/about`

### Strategic role
Explain the relationship between Allotment Technology, Restormel, and SOPHIA.

### Content requirements
- company story
- ecosystem explanation
- why graph-native AI tooling matters
- links to products and showcase app

---

## Cross-site content requirements

Every important page should answer:
1. what this is
2. why it matters
3. how it works
4. how to try it
5. how to integrate it

Every important product page should include:
- screenshot or visual
- short code example
- one architecture diagram
- one use-case example
- CTA to playground or docs

---

## MVP pages to launch first

1. homepage
2. Graph product page
3. GraphRAG product page
4. playground
5. docs
6. pricing
7. console shell
8. about

These are enough to support the first live version.
