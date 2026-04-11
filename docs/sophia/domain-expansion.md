---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

# Domain Expansion

This document tracks which domains are active in SOPHIA itself and which remain exploratory for the showcase app.

## Status model

- `active`: live showcase domain with product-facing support
- `exploratory`: supported in ontology/tooling or under consideration, but not yet a live showcase commitment
- `parked`: intentionally not moving right now
- `archived`: no longer part of the active direction

## Domain status

| Domain | Status | Notes |
| --- | --- | --- |
| Ethics | active | Core live showcase domain. |
| Philosophy of Mind | active | Live showcase domain with explicit selection/routing support in the app. |
| Epistemology | exploratory | Present in shared domain typing and ingestion tooling, not yet an active showcase corpus. |
| Metaphysics | exploratory | Same as above. |
| Political Philosophy | exploratory | Same as above. |
| Logic | exploratory | Present in learning content and broader domain framing, but not a live reasoning corpus commitment. |
| Applied Ethics | exploratory | Present in typing/subdomain logic, but handled within broader ethics positioning for now. |
| Aesthetics | parked | In taxonomy, not on the current showcase path. |
| Philosophy of Science | parked | In taxonomy, not on the current showcase path. |
| Philosophy of Language | parked | In taxonomy, not on the current showcase path. |
| Philosophy of AI | exploratory | Strategically relevant to Restormel positioning, but not yet a live SOPHIA showcase domain. |

## Promotion rule for a new active SOPHIA domain

A domain should not move to `active` until all of the following are true:
- source selection and ingestion workflow are operationally ready
- retrieval quality is acceptable for showcase use
- the product/UI surface knows how to expose the domain clearly
- `docs/sophia/current-state.md` and this file are updated in the same change

## Reference material

- Operational runbook: [../reference/operations/runbooks/domain-expansion-runbook.md](../reference/operations/runbooks/domain-expansion-runbook.md)
- Historical expansion plans: [../archive/delivery/](../archive/delivery/) and [../archive/architecture/](../archive/architecture/)
