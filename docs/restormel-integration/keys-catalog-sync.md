# Keeping providers and models aligned with Restormel Keys

**Third-party catalog API (HTTP / paging / `contractVersion`):** see [`restormel-keys-catalog-integrator-guide.md`](./restormel-keys-catalog-integrator-guide.md).

Sophia pulls **provider metadata and the ModelSelector UI** from the vendored **`@restormel/keys`** package (`vendor/restormel/restormel-keys-*.tgz`).  
**Candidate model ids** for `/api/allowed-models`, routing, and `getAvailableReasoningModels()` come from **`@restormel/contracts`** — `DEFAULT_MODEL_CATALOG` in `packages/contracts/src/providers.ts`.

Those two sources can drift. Use the flow below to stay current.

## 1. Update the Keys packages (CLI / release tarball)

Upstream Keys may ship as npm packages or tarballs from your Restormel Keys repo.

1. In the Restormel Keys workspace, build and pack (or use your published version):

   ```bash
   cd /path/to/restormel-keys
   npm pack
   ```

2. Copy the new `.tgz` files into this repo:

   - `vendor/restormel/restormel-keys-<version>.tgz`
   - `vendor/restormel/restormel-keys-svelte-<version>.tgz` (if the Svelte bundle changed)

3. Point `package.json` `dependencies` at the new filenames and run:

   ```bash
   pnpm install
   ```

4. Run `pnpm run check` and fix any API/type breaks from the upgrade.

## 2. Diff Keys model lists vs contracts

After upgrading Keys (or anytime you want an audit):

```bash
pnpm run restormel:keys-catalog-diff
```

This prints a Markdown table of model ids that appear **only** in Keys or **only** in `DEFAULT_MODEL_CATALOG` (per provider).  
**`google` in Keys maps to `vertex` in contracts.**

Manually merge missing ids into `packages/contracts/src/providers.ts`. It is normal for contracts to list **extra** ids Keys does not ship (e.g. Vertex embedding models) — keep those for ingestion / platform behaviour.

## 3. Restormel project model index (optional, different use case)

`restormelListProjectModels()` calls **`GET …/projects/{id}/models`** on the Restormel dashboard API. That index is used for **ingestion** merging (`ingestionModelCatalogMerge.ts`), not for the reasoning allowed-models path. It complements — but does not replace — Keys + contracts for analyse routing.

## 4. Policy / allowed-models

Even when catalogs match, **`restormelEvaluatePolicies`** may still filter models per environment. A model must be both **listed in contracts** and **allowed by policy** to appear in the UI.
