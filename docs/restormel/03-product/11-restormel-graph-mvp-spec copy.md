# Restormel Graph MVP Specification

## Product name
Restormel Graph

## Category
Reasoning workspace for graph-native debugging and evaluation.

## Purpose
Give developers and evaluation teams a practical way to inspect how an AI system arrived at an answer by compiling traces, retrieval events, and evidence into a structured reasoning workspace.

## Strategic role
Restormel Graph is the first wedge product for the Restormel platform.

It should:
- prove the reasoning object
- improve SOPHIA immediately
- stand alone as a developer tool
- create the clearest public entry point into the platform

## Core user jobs
- inspect support for individual claims
- inspect contradiction and weak support
- inspect provenance from output back to trace and evidence
- compare two runs and see what changed
- export a reasoning or lineage summary
- share a run with collaborators

## Target users
### Primary
- AI engineers
- evaluation / red-team style practitioners
- product teams shipping retrieval-heavy or reasoning-heavy systems

### Secondary
- governance and risk teams
- advanced builders who need visibility, not generic orchestration

## MVP scope
### Must include
- import sample and real run data
- graph workspace
- claim inspector
- evidence inspector
- provenance panel
- contradiction / support highlighting
- compare mode for two runs
- evaluator summary panel
- export basic lineage summary

### Must not include
- broad app-building features
- full orchestration product
- vector / provider management
- generic telemetry dashboards

## Core views
1. Graph / workspace view
2. Claim detail view
3. Evidence detail view
4. Provenance trail view
5. Compare view
6. Evaluator summary
7. Export / share surface

## Differentiation
The product is not valuable because it shows nodes and edges.
It is valuable because it turns traces and evidence into inspectable reasoning structure.

## Monetisable hosted features
- retained runs
- compare history
- collaboration and sharing
- evaluator execution at scale
- lineage exports
- access controls and auditability

## Success criteria
- users can explain why a system answered the way it did
- users can identify weak or contradictory support faster than with logs alone
- users can compare two runs meaningfully
- the same canonical structure powers UI, APIs, and exports
