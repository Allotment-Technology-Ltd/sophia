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

## 3. Project model index vs global catalog (dashboard / Gateway Key)

**Upstream integrator reference (canonical):** [restormel-keys — keys-catalog-sync.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/restormel-integration/keys-catalog-sync.md), OpenAPI **1.3.1+** in [openapi.yaml](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/api/openapi.yaml), behaviour [project-model-index-gateway-api.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/requirements/project-model-index-gateway-api.md).

- **`GET …/projects/{projectId}/models`** (via `restormelListProjectModels()`) returns the **project model index**. The binding list is the JSON array at **`data`** (each row: `id`, `providerType`, `modelId`, `enabled`, nested `model`, etc.). Sophia merges this in `ingestionModelCatalogMerge.ts`. Rows with **`enabled: false`** are ignored in our pickers. The API does **not** emit `data.bindings`; our parser still accepts `data.models` / `data.bindings` defensively.
- Do **not** rely on **`?source=catalog`** on the project path for new code; prefer **`GET …/models`** for the **global** tenant catalog (`restormelListGlobalDashboardModels()`).
- **`POST` / `PUT`** failures: **`error: project_models_validation_failed`**, optional **`detail`**, **`errors[]`** per row — branch in automation on `error` and parse `errors[]` (see upstream OpenAPI component `ProjectModelsValidationError`).
- **Mutations** (Gateway key + `RESTORMEL_PROJECT_ID`): `restormelAddProjectModelBindings`, `restormelReplaceProjectModelAllowlist`, `restormelPatchProjectModelBinding`, `restormelDeleteProjectModelBinding` in `src/lib/server/restormel.ts`. Request bodies use **`models`** (array of `{ providerType, modelId [, enabled] }`).

Reasoning / analyse **allowed-models** still flow from **`@restormel/contracts`** and policy evaluation — the project index is complementary for ingestion control-plane UX.

**Keys deploy:** Postgres migration **`020_project_model_bindings.sql`** on the dashboard DB when rolling an image that serves the index (operator step on Keys, not Sophia).

## 4. Policy / allowed-models

Even when catalogs match, **`restormelEvaluatePolicies`** may still filter models per environment. A model must be both **listed in contracts** and **allowed by policy** to appear in the UI.
