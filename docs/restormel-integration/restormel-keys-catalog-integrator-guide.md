# Restormel Keys — canonical catalog (third-party integrators)

Short steps you can forward to partners building provider/model pickers against Restormel Keys.

## Base URL

Use **`https://restormel.dev`** as the default host, or the **customer’s Restormel base URL** if they self-host.

Catalog path (append to host, no trailing slash on host):

```text
/keys/dashboard/api/catalog
```

**Full example:** `https://restormel.dev/keys/dashboard/api/catalog`

## Fetch (read, no API key)

**Method:** `GET`  
**Auth:** None required for read.

```bash
curl -sS "https://restormel.dev/keys/dashboard/api/catalog?limit=500&offset=0"
```

Query parameters:

| Parameter | Notes |
|-----------|--------|
| `limit` | `1`–`1000`, **default `500`** |
| `offset` | Start index for paging; repeat until you have all rows you need |

## Stability / versioning

- Read **`contractVersion`** from the JSON body (e.g. `2026-03-23.catalog.v1`).
- Treat it as your **schema / compatibility signal**; bump your parser or mappings when it changes.

## Using the payload

- **`providers[]`** — Build **provider** UI from this list. Respect **`validation.mode`** and use **`defaultApiBaseUrl`** when present.
- **`data[]`** — Build **model** UI from rows; when calling vendor APIs, use each variant’s **`providerModelId`** (and any other fields your integration needs from the catalog).

Exact field names and nesting follow the live response for your `contractVersion`; pin tests to a known `contractVersion` when possible.

## Caching & refresh

- **Cache server-side** (not only in the browser).
- **Refresh on a schedule** (e.g. daily).
- Keep a **last-known-good snapshot** if the feed is down so your UI degrades gracefully.

## Optional — Node (server-only)

```bash
pnpm add @restormel/keys
```

```typescript
// Server-only — do not bundle to untrusted clients.
import {
  fetchCanonicalCatalog,
  filterCanonicalCatalogForViability
} from '@restormel/keys/dashboard';
```

Use these helpers when you want typed parsing and viability filtering instead of raw `fetch`.

## Optional — CLI / CI

After **`@restormel/keys-cli`** is published with the catalog command:

```bash
npx @restormel/keys-cli catalog fetch
```

For self-hosted Restormel, set **`RESTORMEL_KEYS_BASE`** (or the host your operator documents) so the CLI targets the right instance.

Useful for **CI checks** or offline snapshots in build pipelines.

## Availability

- **HTTP (`curl` or any client)** works as soon as the **dashboard app** that serves `/keys/dashboard/api/catalog` is deployed.
- **`npx @restormel/keys-cli catalog fetch`** is available **after** a new CLI release that includes the command; until then, integrators should use **curl / HTTP** as above.

## Related (Sophia repo)

For how this repo today compares vendored `@restormel/keys` to local contracts, see [`keys-catalog-sync.md`](./keys-catalog-sync.md).
