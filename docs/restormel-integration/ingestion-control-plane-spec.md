# Restormel-Driven Ingestion Control Plane Spec

Date: 2026-03-19

## Purpose

This document defines the Restormel public surface Sophia needs in order to ship an admin-only ingestion routing mixer without storing routing policy locally.

The design constraint is strict:

- Restormel owns route definitions, ordered provider/model steps, switchover rules, cost simulation, publish state, and audit history.
- Sophia only renders and mutates that Restormel state through server-side proxies.
- MCP remains an operator and agent surface, not the browser mutation path.

## Current public baseline

Public Restormel surfaces available today:

- MCP: published and usable via `@restormel/mcp`
- AAIF docs: advanced contract plus `executeAAIFRequest()` described publicly
- Dashboard API:
  - `POST /projects/{projectId}/resolve`
  - `POST /policies/evaluate`
  - `GET/POST/PATCH/DELETE /projects/{projectId}/routes/{routeId}/steps...`
  - `GET /projects/{projectId}/routing-capabilities`
  - `GET /projects/{projectId}/providers/health`
  - `GET /projects/{projectId}/switch-criteria-enums`

Current blockers:

- `resolve` is still returning `500` against Sophia's live project
- route reads and step reads are still returning `500`
- `simulate` is still returning `500`
- publish, rollback, and history are still returning `404`
- public docs still do not describe the live metadata endpoints above
- public resolve is still not stage-aware
- public step docs are still too narrow for the intended mixer

## Current live probe status

Observed against Sophia's configured Restormel project on 2026-03-19:

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

## Required stable Restormel public API

### 1. Route resources

Required endpoints:

- `GET /projects/{projectId}/routes`
- `POST /projects/{projectId}/routes`
- `GET /projects/{projectId}/routes/{routeId}`
- `PATCH /projects/{projectId}/routes/{routeId}`
- `DELETE /projects/{projectId}/routes/{routeId}`

Required route fields:

```json
{
  "id": "ingestion_grouping",
  "name": "Ingestion grouping",
  "projectId": "proj_123",
  "environmentId": "prod",
  "workload": "ingestion",
  "stage": "grouping",
  "enabled": true,
  "version": 7,
  "publishedVersion": 6,
  "updatedAt": "2026-03-19T12:00:00Z"
}
```

Notes:

- `stage` must be Restormel-owned, not Sophia-owned.
- One route per ingestion stage per environment is the intended model.

### 2. Stage-aware resolve

Restormel must accept the actual ingestion context.

Required request:

```json
{
  "environmentId": "prod",
  "routeId": "ingestion_grouping",
  "workload": "ingestion",
  "stage": "grouping",
  "task": "completion",
  "attempt": 2,
  "estimatedInputTokens": 42000,
  "estimatedInputChars": 160000,
  "complexity": "high",
  "constraints": {
    "maxCost": 0.12,
    "latency": "balanced"
  },
  "previousFailure": {
    "providerType": "anthropic",
    "modelId": "claude-sonnet-4-5",
    "reason": "rate_limit"
  }
}
```

Required response:

```json
{
  "data": {
    "routeId": "ingestion_grouping",
    "selectedStepId": "fallback_vertex",
    "providerType": "google",
    "modelId": "gemini-3.1-pro-preview",
    "estimatedCostUsd": 0.0834,
    "switchReasonCode": "previous_step_rate_limited",
    "matchedCriteria": [
      "onFailureKinds:rate_limit",
      "latencyClass:balanced"
    ],
    "fallbackCandidates": [
      {
        "stepId": "fallback_openai",
        "providerType": "openai",
        "modelId": "gpt-4o"
      }
    ],
    "explanation": "route=ingestion_grouping step=1 provider=google model=gemini-3.1-pro-preview"
  }
}
```

Implementation note:

- This can be a richer `resolve` request or a public AAIF-backed resolve endpoint.
- If AAIF is used, the Dashboard runtime still needs the same machine-readable response fields.

### 3. Rich step schema

Required step shape:

```json
{
  "id": "primary_anthropic",
  "orderIndex": 0,
  "enabled": true,
  "providerPreference": "anthropic",
  "modelId": "claude-sonnet-4-5",
  "switchCriteria": {
    "onFailureKinds": ["timeout", "rate_limit", "provider_unhealthy"],
    "maxEstimatedCostUsd": 0.12,
    "maxEstimatedInputTokens": 60000,
    "maxEstimatedInputChars": 220000,
    "maxAttemptsBeforeSwitch": 1,
    "complexityAbove": "medium",
    "latencyClass": "balanced",
    "requiresHealthyProvider": true
  },
  "retryPolicy": {
    "maxRetries": 1,
    "backoffMs": 1000,
    "retryOnFailureKinds": ["timeout"]
  },
  "costPolicy": {
    "showEstimatedCost": true,
    "warnAboveUsd": 0.08,
    "hardCapUsd": 0.12
  }
}
```

Minimum enum sets:

- failure kinds:
  - `timeout`
  - `rate_limit`
  - `provider_unhealthy`
  - `auth_error`
  - `quota_exceeded`
  - `policy_blocked`
  - `unknown_error`
- complexity:
  - `low`
  - `medium`
  - `high`
- latency:
  - `low`
  - `balanced`
  - `high`

### 4. Simulation and pricing preview

Required endpoint:

- `POST /projects/{projectId}/routes/{routeId}/simulate`

Required request:

- same shape as stage-aware resolve

Required response:

```json
{
  "data": {
    "selectedStepId": "primary_anthropic",
    "estimatedCostUsd": 0.0941,
    "perStepEstimates": [
      {
        "stepId": "primary_anthropic",
        "providerType": "anthropic",
        "modelId": "claude-sonnet-4-5",
        "estimatedCostUsd": 0.0941,
        "wouldRun": true
      },
      {
        "stepId": "fallback_vertex",
        "providerType": "google",
        "modelId": "gemini-3.1-pro-preview",
        "estimatedCostUsd": 0.0834,
        "wouldRun": false,
        "wouldBeSkippedBecause": "primary_step_selected"
      }
    ],
    "switchOutcomePreview": {
      "ifPrimaryFailsWith": ["timeout", "rate_limit"],
      "nextStepId": "fallback_vertex"
    }
  }
}
```

### 5. Metadata endpoints

Useful public endpoints already appearing live:

- `GET /projects/{projectId}/routing-capabilities`
- `GET /projects/{projectId}/providers/health`
- `GET /projects/{projectId}/switch-criteria-enums`

Still required (upstream contract):

- `GET /projects/{projectId}/models`

**Sophia:** When this endpoint returns JSON, `/api/admin/ingestion-routing/model-catalog` merges the response with the static ingestion guide: matching `provider · modelId` labels keep curated copy; unknown models appear with heuristic tiers. If the call fails or the body is empty, the admin UI falls back to the static catalog only.

Required metadata:

- provider labels
- model labels
- pricing metadata
- capability flags
- deprecation state
- provider health
- supported switch-criteria enums

### 6. Draft, publish, rollback, and audit

Required endpoints:

- `POST /projects/{projectId}/routes/{routeId}/validate`
- `POST /projects/{projectId}/routes/{routeId}/publish`
- `POST /projects/{projectId}/routes/{routeId}/rollback`
- `GET /projects/{projectId}/routes/{routeId}/history`

Required audit fields:

- `updatedBy`
- `publishedBy`
- `changeSummary`
- `version`
- `createdAt`
- `publishedAt`

## Sophia integration contract once the surface is stable

### Admin UI

- Add an admin-only “Ingestion Routing” screen.
- Show one Restormel-managed route per ingestion stage:
  - extraction
  - relations
  - grouping
  - validation
  - embedding
  - json_repair
- Each stage card shows:
  - ordered steps
  - provider and model selectors
  - switchover criteria
  - retry policy
  - cost preview
  - route health and publish state

### Sophia backend

- Use server-side proxies over Restormel Dashboard API.
- Do not expose Gateway Keys to the browser.
- Do not store route definitions or fallback chains in Sophia DB or env.

### Sophia runtime

- Each ingestion stage resolves against its Restormel route with stage-aware context.
- Runtime logs should record:
  - routeId
  - selectedStepId
  - providerType
  - modelId
  - switchReasonCode
  - estimatedCostUsd

### Explicit non-goals

- no local Sophia routing DSL
- no local fallback chain editor
- no browser-side MCP writes

## Acceptance tests

### Restormel API acceptance

- route CRUD is project-scoped and environment-scoped
- duplicate `orderIndex` is rejected
- invalid switch criteria are rejected
- simulation returns deterministic per-step estimates
- resolve switches to the next step when failure criteria match
- publish and rollback change the active route version

### Sophia integration acceptance

- admin UI reads stage routes from Restormel only
- edits persist through Sophia server proxies
- simulation preview matches Restormel response, not local heuristics
- runtime ingestion logs selected step and switch reason for every stage
- unauthorized users cannot access routing controls

## Current Sophia posture before the surface is stable

- The app does not ship an ingestion routing editor.
- `ingest_provider` in the admin operations console remains a coarse bootstrap or manual fallback hint only.
- Route IDs in env remain operational bootstrap, not the target control-plane model.
- MCP and AAIF remain useful runtime/operator integrations, but they do not replace the missing or unstable public Dashboard control-plane APIs above.
