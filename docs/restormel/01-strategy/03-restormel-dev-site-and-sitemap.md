# Restormel.dev Site Strategy and Sitemap

## Status
Rewritten v2 to align the public site with Restormel as a graph-native reasoning debugger and evaluator.

## Domain role
`restormel.dev` should serve four functions:
- product homepage
- documentation hub
- playground and import surface
- authenticated workspace / console entry point

It should not read like a generic AI developer platform site. The site should make the category legible fast: Restormel helps teams inspect reasoning, support, contradictions, evidence state, and run-to-run changes.

## Primary objective
Make `restormel.dev` the easiest place on the internet to go from opaque AI output to a structured reasoning workspace.

## Audience design
The site should serve three audiences:
1. developers and AI engineers
2. product and evaluation teams
3. technical buyers in regulated or quality-sensitive settings

## Site message hierarchy
1. Understand the category.
2. See what the workspace shows that logs do not.
3. Try a sample run or import a run.
4. Read the contracts, APIs, and integration docs.
5. Move into workspace, team, or enterprise paths.

## Core pages
- `/` — homepage
- `/product/restormel-graph` — reasoning workspace
- `/product/evals` — graph-aware evaluators
- `/product/lineage` — governance and audit exports
- `/playground` — sample imports and live demos
- `/docs` — documentation hub
- `/docs/contracts`
- `/docs/adapters`
- `/docs/apis`
- `/docs/examples`
- `/pricing`
- `/security`
- `/about`
- `/sophia` — reference application story
- `/login` or `/app` — authenticated entry

## Recommended IA principles
- lead with the workspace, not the infrastructure
- give “how it works” through reasoning-object diagrams, not generic architecture claims
- keep GraphRAG language subordinate to diagnostics and evidence-path visibility
- treat SOPHIA as proof, not as the platform itself
- allow a shallow path from homepage to playground to docs

## Key on-site demos
The site should highlight three walkthroughs:
1. **Support inspection** — show which claims are supported by which evidence.
2. **Contradiction inspection** — show where evidence conflicts or where claim support is weak.
3. **Compare mode** — show what changed between two runs, prompts, models, or retrieval states.

## Playground strategy
The playground should not try to be a generic app builder. It should do a few things well:
- load example reasoning objects
- accept imported traces / evidence bundles
- show graph, provenance, contradiction, and compare views
- export a lineage summary or evaluation summary

## Docs strategy
The docs should be organised around:
- canonical reasoning objects
- adapters and ingestion
- evaluator primitives
- compare workflows
- API and SDK usage
- governance exports
- SOPHIA as an implementation example

## Procurement and trust pages
`/pricing`, `/security`, and enterprise pages should emphasise:
- hosted retention and collaboration
- workspace access control
- lineage export and governance use cases
- deployment options where relevant

## Success criteria
The site is succeeding when a new visitor can answer:
- what Restormel is
- what problem it solves that logs and traces do not
- what the first product is
- how to try it
- how it integrates with their existing stack
