---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Homepage Wireframe and Copy Deck

## Purpose
Define the first public homepage for `restormel.dev` so the platform has a clear, self-serve entry point for both technical professionals and novice AI builders.

## Homepage goal
Move a new visitor from curiosity to action in under two minutes.

Primary action:
**Open Playground**

Secondary action:
**Read Docs**

---

## Audience split
The homepage must work for two main audiences:

### Technical professionals
They want:
- product clarity
- quickstarts
- package names
- APIs and docs
- architecture confidence

### Novice vibe coders
They want:
- immediate value
- easy examples
- minimal setup
- hosted or visual entry points
- confidence they do not need deep graph expertise to begin

---

## Messaging hierarchy
1. Restormel is a developer platform for graph-native AI systems.
2. It helps users visualise, debug, and ship GraphRAG and reasoning workflows.
3. It is self-serve and easy to try.
4. SOPHIA proves the stack in a real product.

---

## Wireframe

### Section 1: hero
#### Layout
- left: headline, subheadline, CTAs
- right: animated or interactive product preview

#### Copy
**Headline**
Graph-native developer tools for explainable AI systems

**Subheadline**
Visualize answer paths, ship GraphRAG, and add structured reasoning to your AI products with Restormel.

**Primary CTA**
Open Playground

**Secondary CTA**
Read Docs

**Microcopy**
Used to power the SOPHIA reference application.

#### Content requirements
- clear value proposition
- one visual that shows graph + trace + answer path
- immediate evidence that this is useful, not abstract

---

### Section 2: product strip
#### Purpose
Explain the product family quickly.

#### Layout
Three or four product cards.

#### Cards and copy
**Restormel Graph**
Visual debugger for graphs, traces, and answer paths.

**Restormel GraphRAG**
Plug-and-play graph-native retrieval for AI applications.

**Restormel Reasoning**
Structured multi-pass reasoning as an API.

**Restormel BYOK**
Bring-your-own-model configuration for flexible AI integrations.

#### CTA
Explore products

---

### Section 3: instant demo / magic moment
#### Purpose
Let visitors experience the platform before signup.

#### Layout
- input panel: paste trace / use sample
- output panel: mini graph and highlighted path

#### Copy
**Section headline**
See what your AI system is doing

**Body**
Paste a graph or trace and Restormel will turn it into an explorable visual map.

**CTA**
Try sample trace

#### Content requirements
- one-click sample
- no auth required in first pass
- support both “technical JSON upload” and “show me an example”

---

### Section 4: audience lanes
#### Purpose
Create two clear self-serve paths.

#### Lane A
**For developers**
Install SDKs, use APIs, and plug visual debugging into your stack.

CTA: Read quickstart

#### Lane B
**For builders**
Use the playground, hosted tools, and templates to add explainable AI faster.

CTA: Browse templates

---

### Section 5: why Restormel
#### Purpose
Explain the category and the gap.

#### Copy pillars
**Visible by default**
Go from opaque outputs to explorable graphs and traces.

**Graph-native**
Move beyond vector-only retrieval and disconnected reasoning.

**Composable**
Use packages, APIs, or hosted products depending on your team’s needs.

**Built in the open through SOPHIA**
See the full stack working in a real reference application.

---

### Section 6: workflow band
#### Purpose
Show how the products fit together.

#### Content
A simple 4-step flow:
1. ingest or retrieve
2. reason and structure
3. visualise and debug
4. embed or ship

#### Supporting copy
Restormel is designed as an ecosystem. Start with the visualizer, add GraphRAG, then move into reasoning and deployment.

---

### Section 7: code example
#### Purpose
Give technical users confidence immediately.

#### Sample content
```ts
import { createGraphRag } from '@restormel/graphrag-core'
import { openVisualizer } from '@restormel/sdk'
```

#### CTA
View docs

---

### Section 8: SOPHIA proof section
#### Purpose
Show a real application built on the platform.

#### Copy
**See the platform in action**
SOPHIA is the public reference application built on Restormel packages. It demonstrates graph-native retrieval, structured reasoning, visual traces, and provider-flexible execution in one end-to-end experience.

CTA: Explore SOPHIA

---

### Section 9: trust / procurement
#### Purpose
Prepare future buyers and teams.

#### Content requirements
- security and privacy summary
- BYOK note
- hosted vs self-managed note
- marketplace teaser

#### Copy
Deploy self-serve today. Bring Restormel into team workflows tomorrow.

CTA: View deployment options

---

### Section 10: final CTA
#### Copy
Start with a graph. End with a platform.

Buttons:
- Open Playground
- Create Account

---

## Tone requirements
- precise
- confident
- technically literate
- not overhyped
- visually intelligent
- approachable for non-experts

Avoid:
- vague AI buzzwords
- heavy enterprise cliché
- overly academic phrasing on the homepage

---

## Visual requirements
- dark, elegant, high-contrast base
- graph lines and node accents used sparingly
- clear product cards
- animated trace preview in hero
- strong typographic hierarchy
- “tool, not toy” feel

---

## Required content assets
- hero animation or prototype
- product icons or glyphs
- sample trace fixture
- code snippet examples
- SOPHIA screenshot or mini walkthrough
- deployment / BYOK explainer block

---

## Success criteria
- users understand what Restormel does in under 10 seconds
- users can reach a working demo in one click
- developers can reach docs in one click
- builders can see a low-friction path without technical intimidation
