# Restormel Platform: Milestone Plan with Exit Criteria

## Purpose
Translate the platform strategy into milestones with explicit exit criteria.

## Milestone 0: Foundation locked
### Objective
Lock naming, hierarchy, and build-vs-integrate rules.
### Exit criteria
- Restormel / SOPHIA / Allotment roles fixed
- package map approved
- canonical terminology approved
- docs pack rewritten consistently

## Milestone 1: Contracts extraction
### Objective
Stand up `@restormel/contracts`.
### Exit criteria
- contracts package published internally
- zod validators and fixtures working
- SOPHIA consuming shared contract types in at least one path

## Milestone 2: Graph and reasoning core
### Objective
Extract `graph-core` and first `reasoning-core`.
### Exit criteria
- shared graph transforms live
- reasoning compilation works over imported data
- no hard dependency on SOPHIA-only shapes

## Milestone 3: Workspace MVP
### Objective
Ship Restormel Graph MVP.
### Exit criteria
- graph workspace
- claim/evidence/provenance inspectors
- sample imports
- basic compare mode

## Milestone 4: Evaluators and exports
### Objective
Ship graph-aware evaluation and lineage output.
### Exit criteria
- evaluator runner working
- at least three evaluator types
- lineage export generated from canonical object

## Milestone 5: Hosted product
### Objective
Add persistence, auth, and team basics.
### Exit criteria
- saved runs
- auth
- sharing
- pricing hooks
- basic usage tracking

## Milestone 6: Enterprise readiness
### Objective
Support procurement and larger customers.
### Exit criteria
- security materials
- admin controls
- enterprise packaging
- marketplace-ready SKU if justified
