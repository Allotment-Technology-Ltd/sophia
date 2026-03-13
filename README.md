---
status: active
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

# SOPHIA

SOPHIA is the showcase and reference application for the Restormel platform.

This repository currently combines:
- the public SOPHIA product surfaces for reasoning, learning, and API access
- the in-repo implementation of graph-grounded reasoning, verification, BYOK, and billing flows
- the active Restormel platform planning pack under `docs/restormel/`

## Start here

- SOPHIA docs: [docs/sophia/README.md](docs/sophia/README.md)
- Current SOPHIA state: [docs/sophia/current-state.md](docs/sophia/current-state.md)
- SOPHIA architecture: [docs/sophia/architecture.md](docs/sophia/architecture.md)
- Restormel platform docs: [docs/restormel/00-overview/00-master-index.md](docs/restormel/00-overview/00-master-index.md)
- Historical material: [docs/archive/README.md](docs/archive/README.md)

## Working model

- `Restormel` is the platform and product family.
- `SOPHIA` is the showcase/reference app that demonstrates the platform in a real product.
- Detailed product, roadmap, and architecture truth for SOPHIA now lives under `docs/sophia/`, not in the older root-level documents.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Useful commands:
- `pnpm check`
- `pnpm test`
- `pnpm dev:prod-db`

For operational runbooks, API reference, and deeper implementation notes, use [docs/README.md](docs/README.md).
