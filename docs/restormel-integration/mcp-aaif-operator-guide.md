# Restormel MCP + AAIF Operator Guide

## Current state

- Sophia now routes reasoning traffic through Restormel-backed resolution by default.
- Ingestion stage planning now builds AAIF-shaped stage requests and resolves stage routes through Restormel before execution.
- The beta AAIF endpoint is available at `POST /api/beta/aaif`.
- The official Restormel MCP runtime is installed in this repo as `@restormel/mcp`.
- The full admin ingestion-routing mixer is not shipped. Public Dashboard APIs are still too narrow for a true Restormel-owned stage editor.

## Sophia admin: Auto configure with MCP

On **`/admin/ingestion-routing`**, the header includes **Auto configure with MCP**. It opens a panel that (1) applies recommended ingestion routes across all stages inside Sophia (same automation as the former “Invoke Restormel MCP” control) and (2) provides a **copy-ready MCP client JSON** with `RESTORMEL_EVALUATE_URL` taken from the deployment environment and a placeholder for the gateway key.

## Running the official MCP server

Use the published runtime directly:

```bash
pnpm mcp:restormel
```

Recommended client config:

```json
{
  "mcpServers": {
    "restormel": {
      "command": "pnpm",
      "args": ["exec", "restormel-mcp"],
      "env": {
        "RESTORMEL_GATEWAY_KEY": "...",
        "RESTORMEL_EVALUATE_URL": "https://restormel.dev/keys/dashboard/api/policies/evaluate"
      }
    }
  }
}
```

Environment notes:

- `RESTORMEL_GATEWAY_KEY` is required for remote entitlement checks.
- `RESTORMEL_EVALUATE_URL` enables `entitlements.check` against the live policy endpoint.
- Provider validation tools use either `RESTORMEL_MCP_<PROVIDER>_KEY` or the normal provider env vars.

## Supported MCP tools

- `models.list`
- `providers.validate`
- `cost.estimate`
- `routing.explain`
- `entitlements.check`
- `integration.generate`
- `docs.search`

These tools help you **inspect** models, explain routing, and validate providers. They do **not** create or update Dashboard route definitions or ordered step lists. For mutating routes/steps, use the **CLI** below or the Restormel Dashboard API directly.

## Configure route steps via CLI (recommended for agents & CI)

Use the repo script that calls the same Dashboard endpoints as Sophia’s admin proxies (`RESTORMEL_GATEWAY_KEY` + `RESTORMEL_PROJECT_ID`):

```bash
npm run restormel:route-steps -- list-routes
npm run restormel:route-steps -- get-steps <routeId>
npm run restormel:route-steps -- apply-steps <routeId> scripts/restormel/examples/extraction-steps.example.json
# or pipe JSON:
cat my-steps.json | npm run restormel:route-steps -- apply-steps <routeId>
npm run restormel:route-steps -- capabilities
```

Payload for `apply-steps` is a **JSON array of steps** (same as the Ingestion Routing admin textarea), or `{ "steps": [ ... ] }`. Add as many steps as you need; `orderIndex` defines the failover chain. Example: `scripts/restormel/examples/extraction-steps.example.json`.

## AAIF vs route configuration

- **AAIF** (`POST /api/beta/aaif` and `executeAAIFRequest`) is for **runtime** chat/completion/embedding requests with routing constraints — not for CRUD on Restormel routes or steps.
- **Route/step configuration** belongs in Restormel (Dashboard or the CLI above). Ingestion planning then **consumes** those routes at execution time.

## Burn-in checks after deploy

Run these after the 100% Restormel release is live:

1. `pnpm check`
2. `pnpm test`
3. `pnpm smoke:restormel`
4. Exercise `POST /api/beta/aaif` with `chat`, `completion`, and `embedding`.
5. Confirm `/api/v1/verify` still returns the same schema and now reports the actual routed model id.
6. Run the MCP server in a client and confirm all seven tools respond with live credentials.
7. Run `npx tsx --env-file=.env scripts/ingest.ts <source.txt> --validate` and confirm each stage logs a Restormel-planned provider/model/routing source instead of local model profiles.

## Known constraints

- The published MCP runtime is usable today.
- The public AAIF docs now describe an advanced contract and `executeAAIFRequest()`, but Sophia still ships a local compatibility package for `@restormel/aaif` until the upstream npm package is published.
- AAIF embedding output is currently serialised JSON because the public AAIF response contract only defines `output: string`.
- The public Dashboard `resolve` surface still documents only `environmentId` and optional `routeId`; it does not yet expose stage-aware runtime inputs such as task, complexity, cost, latency, or previous failure context.
- The live Dashboard surface now appears to expose `routing-capabilities`, `providers/health`, and `switch-criteria-enums`, but they are still undocumented in the public Dashboard docs.
- The live Sophia project currently fails `pnpm smoke:restormel` because `resolve` is returning `500 Internal Error`.
- Live route reads, step reads, and simulate are also returning `500 Internal Error` against Sophia's current project.
- Publish, rollback, and history are still not live on the probed route paths.
- The `ingest_provider` field in Sophia admin operations remains a coarse bootstrap/manual fallback hint. It is not the future ingestion routing control plane.

## Control-plane spec

The current implementation target for the missing public Restormel surface is documented in:

- `docs/restormel-integration/ingestion-control-plane-spec.md`
- `docs/restormel-integration/upstream-findings-report.md`
