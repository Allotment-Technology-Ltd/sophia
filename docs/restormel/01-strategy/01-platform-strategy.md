# Restormel Platform Strategy

## Status
Draft v1 based on product discovery workshop and architectural review of the SOPHIA codebase.

## Executive summary
Allotment Technology should be positioned as the parent company and Restormel as the developer platform brand. SOPHIA should be repositioned as the public reference application that demonstrates the full power of the platform, rather than acting as the sole commercial product.

The platform thesis is that AI products are rapidly moving from simple prompt wrappers to graph-aware systems composed of retrieval, reasoning, memory, orchestration, and explainability layers. Most current tooling is either too opaque, too enterprise-heavy, too framework-specific, or too difficult for non-specialist builders to adopt.

Restormel should solve this by offering reusable, graph-native developer tools that make AI systems understandable, configurable, and trustworthy.

## Strategic reframe

### Parent company
**Allotment Technology Ltd**

Role:
- company brand
- legal entity
- umbrella for multiple products
- long-term ecosystem owner

### Platform brand
**Restormel**

Role:
- developer platform for graph-native AI systems
- home for reusable packages, APIs, SDKs, UI, and tooling
- destination for docs, playgrounds, console, self-serve onboarding, and cloud marketplace listings

### Reference application
**SOPHIA**

Role:
- flagship showcase app
- proof that the platform works end to end
- public demonstration of GraphRAG, reasoning, observability, and visual explainability
- dogfooding environment for the platform components

## Vision
Make AI systems understandable, configurable, and trustworthy through reusable graph-native developer tools.

## Mission
Build the easiest platform for developers to add graph-grounded retrieval, structured reasoning, and visual explainability to any AI product.

## Category
**Graph-native AI developer platform**

This category is broad enough to include:
- graph visualisation and observability
- GraphRAG infrastructure
- structured reasoning APIs
- provider configuration and BYOK layers
- embeddable AI features
- reference applications like SOPHIA

## Core thesis
AI teams increasingly need more than model access. They need:
- graph-aware retrieval
- transparent answer paths
- structured reasoning
- reliable context-pack construction
- provider flexibility
- visual debugging and observability

Restormel should compete by being:
- easier to adopt
- more visual
- more composable
- more inspectable
- more accessible to both technical teams and novice builders

## Strategic principles

### 1. Modular first
Every core capability should be extractable into a reusable package, SDK, API, or UI module.

### 2. SOPHIA is downstream
SOPHIA should consume shared Restormel modules rather than owning bespoke internal logic where avoidable.

### 3. Visual before abstract
If the platform is doing something important, the user should be able to see it: graph state, retrieval path, pass flow, grounding, verification, and provenance.

### 4. Configurable by default
Every platform capability should be useful beyond philosophy. Users should be able to swap:
- ontology
- provider
- model
- prompts
- schemas
- relation types
- graph structure

### 5. Fast path to first success
Restormel products must be easy to try. The first interaction should create visible value within minutes, ideally seconds.

## User segments

### Segment A: AI developers
Needs:
- observability
- better retrieval
- structured outputs
- clear traces
- composable APIs

Best-fit products:
- Restormel Graph
- GraphRAG Toolkit
- Reasoning API

### Segment B: vibe coders / solo builders
Needs:
- simple self-serve tooling
- hosted flows
- templates
- visual feedback
- minimal infrastructure setup

Best-fit products:
- Restormel Graph playground
- BYOK Kit
- hosted GraphRAG
- starter kits and templates

### Segment C: product teams shipping AI features
Needs:
- provider flexibility
- budget control
- traceability
- easier procurement
- marketplace availability

Best-fit products:
- Reasoning API
- BYOK
- hosted GraphRAG
- cloud marketplace listings

### Segment D: domain products
Example domains:
- education
- policy
- legal
- research
- debate
- knowledge management

Needs:
- structured claims
- argument mapping
- source-grounded output
- explainable reasoning

SOPHIA is a strong proof surface for this segment, but the platform should remain domain-agnostic.

## Product portfolio

### 1. Restormel Graph
Visual debugger for graphs, traces, and answer paths.

Jobs:
- see graph structure
- inspect node and edge metadata
- understand retrieval and reasoning paths
- debug graph-backed AI systems

### 2. Restormel GraphRAG
Plug-and-play graph-native retrieval and context construction.

Jobs:
- ingest documents
- build graph-aware retrieval results
- return context packs with traces
- improve over vector-only RAG

### 3. Restormel Reasoning
Structured multi-pass reasoning as an API.

Jobs:
- generate analysis, critique, synthesis
- expose inspectable reasoning artifacts
- stream structured events
- support downstream applications

### 4. Restormel BYOK
Bring-your-own-key / provider-flexible layer for third-party apps.

Jobs:
- let product owners embed AI features quickly
- support provider choice
- manage model access and spending constraints
- lower hosting and trust friction

### 5. SOPHIA
Reference app that demonstrates the platform working together.

## Recommended sequencing

### Phase 1: wedge
**Restormel Graph**

Why first:
- easiest to demonstrate
- immediately improves SOPHIA
- strong shareability
- useful across many ecosystems

### Phase 2: power layer
**Restormel GraphRAG**

Why second:
- technically differentiated
- strong platform value
- tightly connected to visualisation

### Phase 3: intelligence layer
**Restormel Reasoning**

Why later:
- needs stronger proof, trust, and positioning
- more valuable once graph + trace patterns are established

### Phase 4: distribution multiplier
**Restormel BYOK**

Why after:
- strongest once hosted workflows and console exist
- helps distribution into third-party apps and product teams

## Strategic risks

### Risk 1: too much breadth too early
Mitigation:
- one monorepo
- one canonical schema set
- one visible wedge product first

### Risk 2: strong architecture, weak product proof
Mitigation:
- build demos, playgrounds, visual traces, and adoption-oriented docs in parallel

### Risk 3: SOPHIA continues swallowing roadmap capacity
Mitigation:
- extract shared logic early
- define platform package boundaries before adding major new SOPHIA features

### Risk 4: unclear category language
Mitigation:
- anchor messaging around graph-native AI infrastructure, visual explainability, GraphRAG, and structured reasoning

## Success measures
Early indicators:
- graph playground usage
- trace uploads / imports
- package installs
- docs visits from quickstart pages
- successful self-serve activations

Mid-term indicators:
- hosted GraphRAG projects created
- API keys generated
- paid developer/team accounts
- marketplace-approved listing(s)

Long-term indicators:
- external products built on Restormel
- SOPHIA consuming stable platform packages
- repeatable enterprise procurement path

## One-sentence strategy
Build Restormel into the easiest way for developers and builders to see, debug, and ship graph-native AI systems, while using SOPHIA as the public demonstration of what the platform can do end to end.
