---
title: Restormel Build Pack 05: Concrete Launch Sequence for restormel.dev
owner: platform-delivery
product: restormel
doc_type: launch_sequence
last_reviewed: 2026-03-13
sync_to_linear: true
---

# Restormel Build Pack 05: Concrete Launch Sequence for restormel.dev

## Purpose

This document defines the launch sequence for `restormel.dev` as the entry point to the Restormel platform.

The goal is not to launch everything at once. The goal is to stage the site and product surface so that:

- developers can understand the platform quickly
- early users can try something immediately
- the platform can evolve from demo to self-serve product environment
- future marketplace and enterprise motions have a stable front door

## Launch Principle

Launch `restormel.dev` in **progressive layers**.

The site should evolve through five stages:

1. teaser and narrative layer
2. docs and product explanation layer
3. playground layer
4. self-serve console layer
5. commercial and marketplace layer

## Stage 0: Foundations

### Objective
Prepare the technical and brand foundation before any public launch.

### Required inputs
- brand system
- package names confirmed
- homepage copy direction confirmed
- first visual language established
- domain and hosting configured

### Deliverables
- DNS and hosting set up
- analytics baseline
- core site shell
- design system tokens
- placeholder docs structure

## Stage 1: Public Landing Site

### Objective
Establish Restormel as a real platform brand.

### Live routes
- `/`
- `/products`
- `/docs` (stub or early docs)
- `/playground` (coming soon or limited samples)
- `/blog` or `/changelog`

### Homepage goals
- explain Restormel clearly
- frame the product family
- establish the platform relationship to SOPHIA
- push users toward the playground and docs

### Messaging focus
- graph-native developer tools
- visual debugging for AI systems
- GraphRAG and reasoning as reusable infrastructure

### Definition of done
A new visitor understands:
- what Restormel is
- who it is for
- what products exist
- where to try it

## Stage 2: Playground Launch

### Objective
Create the first real magic moment.

### Live routes
- `/playground`
- `/playground/samples`
- `/graph`

### First playground capabilities
- paste graph JSON
- upload graph JSON
- load sample SOPHIA trace
- load sample GraphRAG trace
- graph view
- pipeline view
- node inspector

### Call to action
- create account to save runs
- read docs to integrate with your own app

### Launch content needed
- sample files
- short usage guide
- one technical demo post
- one social demo clip or screen recording

### Definition of done
A user can go from landing page to first visual insight without speaking to anyone.

## Stage 3: Docs and Quickstart Launch

### Objective
Turn curiosity into technical adoption.

### Live docs sections
- quickstart
- Graph package overview
- GraphRAG quickstart
- Reasoning API preview
- schema reference
- examples and templates

### Minimum quickstarts
- visualize a graph JSON file
- open a SOPHIA run in Restormel
- run a basic GraphRAG example locally

### Definition of done
A technical user can install or integrate at least one product without manual support.

## Stage 4: Console Beta

### Objective
Introduce a self-serve environment.

### Live routes
- `/console`
- `/console/projects`
- `/console/api-keys`
- `/console/runs`
- `/console/providers`

### Minimum console capabilities
- sign in
- create project
- issue API key
- view saved runs
- inspect graph and trace outputs
- manage provider settings for platform-managed mode first

### Optional beta gate
Invite-only or waitlist during early reliability phase.

### Definition of done
A user can create an account, run something, and return later to inspect it.

## Stage 5: GraphRAG Hosted Beta

### Objective
Ship the first hosted API product.

### Live routes
- `/graphrag`
- `/docs/graphrag`
- `/pricing`
- `/console/usage`

### Minimum product features
- API key auth
- ingest endpoint
- retrieve endpoint
- trace output
- open result in Restormel viewer

### Messaging focus
- move beyond vector-only RAG
- see retrieval and answer paths
- graph-backed context packs

### Definition of done
A developer can sign up and make a successful hosted GraphRAG call end to end.

## Stage 6: Reasoning API Preview

### Objective
Position the deeper intelligence layer without overextending too early.

### Live routes
- `/reasoning`
- `/docs/reasoning`
- preview or beta signup flow

### Minimum capabilities
- request spec published
- sample response shape
- early beta flow or limited availability

### Definition of done
The platform story is coherent and the next product is legible, even if adoption is still controlled.

## Stage 7: Marketplace and Procurement Layer

### Objective
Add enterprise and procurement routes once hosted products are mature.

### Live routes
- `/marketplace`
- `/deployments`
- `/security`
- `/contact` or `/enterprise`

### Minimum content
- AWS path
- Microsoft path
- GCP path
- architecture overview
- entitlement and onboarding model

### Definition of done
A technical buyer can understand how to buy and deploy Restormel through enterprise channels.

## Launch Sequence Timeline

## Phase A: Brand and presence
- launch homepage
- launch product pages
- launch docs shell

## Phase B: Demo utility
- launch playground
- publish sample traces
- publish first demo content

## Phase C: Developer onboarding
- launch quickstarts
- launch package docs
- release first installable package or SDK

## Phase D: Self-serve platform
- launch console beta
- launch API keys
- launch saved runs

## Phase E: Hosted product
- launch GraphRAG hosted beta
- connect console, docs, pricing, and playground

## Conversion Paths by User Type

### Curious visitor
Homepage → Playground → Docs

### Technical evaluator
Homepage → Docs → Quickstart → Console

### Vibe coder
Homepage → Playground → Template → Console

### Buyer
Homepage → Products → Pricing → Security / Marketplace

## Content Needed for Launch

### For Stage 1
- homepage copy
- product summaries
- company/platform explanation

### For Stage 2
- sample graphs
- sample traces
- playground helper copy
- share images and clips

### For Stage 3
- quickstarts
- schema docs
- integration examples

### For Stage 4+
- API docs
- pricing
- security docs
- billing help
- support flows

## Metrics to Watch by Stage

### Stage 1
- homepage conversion to docs or playground
- bounce rate

### Stage 2
- playground starts
- successful imports
- sample run usage

### Stage 3
- doc completion
- quickstart success rate
- package installs

### Stage 4
- accounts created
- API keys created
- return usage

### Stage 5
- successful hosted calls
- trace viewer opens
- first paid conversions

## Risks and Mitigations

### Risk 1: launching too much at once
Mitigation: stage the rollout and keep one primary CTA per stage.

### Risk 2: homepage says more than the product can do
Mitigation: keep claims tied to real demo paths.

### Risk 3: docs lag the product
Mitigation: docs launch is a core milestone, not an afterthought.

### Risk 4: novice users get lost
Mitigation: keep a beginner path through the playground and templates.

## Recommended First Public Launch

The first public version of `restormel.dev` should include:

- homepage
- product overview
- docs shell
- playground with sample SOPHIA and GraphRAG traces
- clear relationship to SOPHIA as the public reference app

That gives the ecosystem a credible front door without requiring the full hosted platform to be ready on day one.

## Summary

`restormel.dev` should launch as a **useful entry point**, not just a brochure. The staged sequence above gives you a controlled way to move from brand presence to self-serve platform without losing clarity or overbuilding too early.
