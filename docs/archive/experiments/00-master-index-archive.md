# Restormel Platform Master Index

This document is the front door to the full Restormel planning and build pack.
It links the strategy, architecture, design, execution, and monetisation documents in recommended reading order.

---

## 0. Source Assessment

1. [SOPHIA repo assessment](sandbox:/mnt/data/sophia-repo-assessment.md)

Use this to ground the platform strategy in the actual repo and current technical strengths and weaknesses.

---

## 1. Strategy Pack

2. [Platform strategy](sandbox:/mnt/data/01-platform-strategy.md)
3. [Architectural modularisation plan](sandbox:/mnt/data/02-architectural-modularisation-plan.md)
4. [Restormel.dev site and sitemap](sandbox:/mnt/data/03-restormel-dev-site-and-sitemap.md)
5. [Marketplace strategy](sandbox:/mnt/data/04-marketplace-strategy.md)

These documents define the ecosystem strategy, product hierarchy, domain usage, and marketplace direction.

---

## 2. Brand, Content, and Delivery Pack

6. [Brand identity and voice](sandbox:/mnt/data/05-brand-identity-and-voice.md)
7. [Site pages outline and content requirements](sandbox:/mnt/data/06-site-pages-outline-and-content-requirements.md)
8. [Overarching implementation plan](sandbox:/mnt/data/07-overarching-implementation-plan.md)
9. [Phased programmes of work](sandbox:/mnt/data/08-phased-programmes-of-work.md)

These documents define how Restormel should sound, look, communicate, and move from strategy into delivery.

---

## 3. Execution Pack

10. [Package boundary spec](sandbox:/mnt/data/09-package-boundary-spec.md)
11. [Canonical schema spec](sandbox:/mnt/data/10-canonical-schema-spec.md)
12. [Restormel Graph MVP spec](sandbox:/mnt/data/11-restormel-graph-mvp-spec.md)
13. [Restormel GraphRAG MVP spec](sandbox:/mnt/data/12-graphrag-mvp-spec.md)
14. [Homepage wireframe and copy deck](sandbox:/mnt/data/13-homepage-wireframe-and-copy-deck.md)

These define the technical product boundaries, shared contracts, and first MVP product surfaces.

---

## 4. Build Pack

15. [Monorepo folder blueprint](sandbox:/mnt/data/14-monorepo-folder-blueprint.md)
16. [First extraction backlog by file/module](sandbox:/mnt/data/15-first-extraction-backlog-by-file-module.md)
17. [Restormel Graph UX spec](sandbox:/mnt/data/16-restormel-graph-ux-spec.md)
18. [API surface drafts for hosted GraphRAG and Reasoning](sandbox:/mnt/data/17-api-surface-drafts-hosted-graphrag-and-reasoning.md)
19. [Concrete launch sequence for restormel.dev](sandbox:/mnt/data/18-concrete-launch-sequence-restormel-dev.md)

These documents convert the MVP and architecture work into repo structure, extraction work, UX detail, API shapes, and launch sequencing.

---

## 5. Delivery Control Pack

20. [Milestone plan with exit criteria](sandbox:/mnt/data/restormel-build-pack/19-milestone-plan-with-exit-criteria.md)
21. [Engineering backlog by epic](sandbox:/mnt/data/restormel-build-pack/20-engineering-backlog-by-epic.md)
22. [Design backlog by surface](sandbox:/mnt/data/restormel-build-pack/21-design-backlog-by-surface.md)
23. [Monetisation strategies by product](sandbox:/mnt/data/restormel-build-pack/22-monetisation-strategies-by-product.md)

These documents provide the operating model for delivery, prioritisation, design, and commercialisation.

---

## Recommended Reading Order

### If you want the quickest strategic overview
Read:
- Platform strategy
- Architectural modularisation plan
- Marketplace strategy
- Monetisation strategies by product

### If you want the product and site picture
Read:
- Brand identity and voice
- Restormel.dev site and sitemap
- Site pages outline and content requirements
- Homepage wireframe and copy deck
- Restormel Graph UX spec

### If you want the engineering and delivery plan
Read:
- Package boundary spec
- Canonical schema spec
- Monorepo folder blueprint
- First extraction backlog by file/module
- Milestone plan with exit criteria
- Engineering backlog by epic

### If you want the full ecosystem picture
Read in numerical order from 1 to 23.

---

## Document Groups by Decision Type

### Strategic decisions
- platform strategy
- modularisation plan
- marketplace strategy
- monetisation strategies

### Product decisions
- MVP specs
- site and sitemap
- page outlines
- UX spec
- launch sequence

### Technical architecture decisions
- package boundary spec
- canonical schema spec
- monorepo blueprint
- extraction backlog
- API surface drafts

### Delivery decisions
- implementation plan
- phased programmes of work
- milestone plan
- engineering backlog
- design backlog

---

## Suggested Next Working Artifacts

After this pack, the strongest next artifacts would be:

1. Architecture decision records (ADRs)
2. Canonical JSON examples for graph, trace, and reasoning payloads
3. Restormel homepage design comps
4. Figma design system setup
5. First extraction sprint board
6. Pricing model draft with example numbers

---

## File Locations

### Core planning pack
Files 01 to 18 live in `/mnt/data/`

### Delivery control pack
Files 19 to 22 live in `/mnt/data/restormel-build-pack/`

---

## Working Note

This pack assumes:

- **Allotment Technology** is the parent company
- **Restormel** is the developer platform and product family
- **SOPHIA** is the public reference application / showcase
- the ecosystem is the product, and the individual apps demonstrate and monetize parts of that ecosystem
