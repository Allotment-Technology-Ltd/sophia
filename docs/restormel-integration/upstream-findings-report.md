# Restormel Control Plane + MCP + AAIF Upstream Findings

Date: 2026-03-19

Reviewed against:

- https://restormel.dev/keys/docs/integrations/mcp
- https://restormel.dev/keys/docs/integrations/aaif
- https://restormel-keys-gateway-main-bc13eba.zuplo.site/dashboard-api/overview
- https://restormel-keys-gateway-main-bc13eba.zuplo.site/dashboard-api/resolve
- https://restormel-keys-gateway-main-bc13eba.zuplo.site/dashboard-api/policies-evaluate
- https://restormel-keys-gateway-main-bc13eba.zuplo.site/dashboard-api/routes-steps

Direct live probes were also run against Sophia's configured Restormel project and Gateway Key on 2026-03-19.

## Live probe summary

| Endpoint | Result |
| --- | --- |
| `POST /policies/evaluate` | `200` |
| `GET /projects/{projectId}/routing-capabilities` | `200` |
| `GET /projects/{projectId}/providers/health` | `200` |
| `GET /projects/{projectId}/switch-criteria-enums` | `200` |
| `POST /projects/{projectId}/resolve` | `500` |
| `GET /projects/{projectId}/routes` | `500` |
| `GET /projects/{projectId}/routes/{routeId}/steps` | `500` |
| `POST /projects/{projectId}/routes/{routeId}/simulate` | `500` |
| `POST /projects/{projectId}/routes/{routeId}/publish` | `404` |
| `POST /projects/{projectId}/routes/{routeId}/rollback` | `404` |
| `GET /projects/{projectId}/routes/{routeId}/history` | `404` |

## Breaking issues

### Resolve is currently breaking live

`POST /projects/{projectId}/resolve` returned `500 Internal Error` against Sophia's live project with a valid Gateway Key.

Impact:

- `pnpm smoke:restormel` currently fails
- Sophia cannot rely on the public Restormel control plane for routing rollout
- no admin routing surface should be built on top of the current live resolve path

### Route reads are present as paths but not stable

`GET /projects/{projectId}/routes` and `GET /projects/{projectId}/routes/{routeId}/steps` both returned `500 Internal Error`.

Impact:

- Sophia still cannot render a Restormel-owned route editor
- route discovery and stage chain reads are not reliable enough for the mixer

### Simulate appears to exist but is failing live

`POST /projects/{projectId}/routes/{routeId}/simulate` returned `500 Internal Error` for multiple request shapes.

Impact:

- Sophia still cannot use Restormel for the intended per-stage cost preview
- the cost panel remains blocked even though a likely simulation path now exists

### Route lifecycle endpoints are still absent or inactive

`publish`, `rollback`, and `history` route paths returned `404`.

Impact:

- there is still no safe publish or rollback lifecycle for production route editing
- Sophia still cannot ship a production-safe editor

### Public resolve docs are still too narrow for stage routing

The public `resolve` docs still only describe:

- `environmentId`
- optional `routeId`

They still do not describe:

- `workload`
- `stage`
- `task`
- `attempt`
- `estimatedInputTokens`
- `estimatedInputChars`
- `complexity`
- `constraints.maxCost`
- `constraints.latency`
- `previousFailure`

Impact:

- Sophia still cannot ask Restormel to switch routes based on ingestion-stage context
- AAIF-level runtime constraints are still not wired through the public Dashboard contract

### Public step docs are still too narrow for the intended switchover model

The public steps docs still describe typical step fields as:

- `orderIndex`
- `enabled`
- `providerPreference`
- `modelId`
- `fallbackOn`

Missing documented step fields for the intended Sophia mixer:

- `switchCriteria`
- `retryPolicy`
- `costPolicy`
- token and character limits
- complexity thresholds
- latency thresholds

Impact:

- Sophia still cannot expose user-defined switchover rules without inventing a local policy layer

### AAIF docs and package distribution are still mismatched

The AAIF docs now describe an advanced package and runtime helper, but `@restormel/aaif` is still not publicly installable from npm.

Impact:

- Sophia still needs a local compatibility package
- public docs and package availability remain out of sync

### AAIF response shape is still not sufficient for embeddings

The public AAIF response still defines `output: string`.

Impact:

- Sophia still has to serialize embedding vectors into JSON strings
- typed interoperability still breaks down on embedding tasks

## Improvements

### Document the endpoints that are already live

These live endpoints now exist but are still undocumented in the public Dashboard docs:

- `GET /projects/{projectId}/routing-capabilities`
- `GET /projects/{projectId}/providers/health`
- `GET /projects/{projectId}/switch-criteria-enums`

### Stabilize route reads, resolve, and simulate before expanding further

The most immediate product need is reliability:

- `resolve` must stop returning `500`
- `routes` reads must stop returning `500`
- `steps` reads must stop returning `500`
- `simulate` must stop returning `500`

### Publish a public Dashboard OpenAPI

The public steps docs still say “see product OpenAPI for full schema”, but no public Dashboard OpenAPI is discoverable from the documented surface.

### Expand resolve to accept stage-aware context

Once stable, the public resolve contract should accept:

- stage/workload/task context
- cost and latency constraints
- prior failure context

### Add a full route lifecycle

Minimum public lifecycle surface:

- validate draft
- publish draft
- rollback published version
- inspect change history

### Keep MCP as the operator surface, not the browser write path

`@restormel/mcp` is healthy and useful for operator tooling, but the app integration story still needs Dashboard mutation APIs rather than routing browser/admin writes through MCP.

### Publish `@restormel/aaif` or narrow the docs

Either publish the package the docs describe, or narrow the docs to match the public distribution reality.

### Add an embedding-specific AAIF response or structured output

Either add a dedicated embedding response shape, or generalize `output` to structured content.
