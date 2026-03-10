# BYOK (Bring Your Own Key) Rollout Plan

**Status:** Planned backlog item (next engineering stream)  
**Priority framing:** Subsequent engineering stream — BYOK follows Vertex ingestion migration and near-term grant funding application work  
**Scope:** Maintained docs only; no implementation changes in this document

---

## Purpose

Ship BYOK (Bring Your Own Key) so users provide their own model-provider credentials, reducing platform-funded inference costs and enabling provider choice. Monetization is explicitly deferred until BYOK is stable.

---

## Rollout order

1. **Phase 1** — BYOK foundation (Vertex + Anthropic)
2. **Phase 1b** — OpenAI key + model expansion
3. **Phase 1c** — Additional providers via plugin model (starting with Voyage and xAI/Grok)
4. **Phase 2** — Monetization (deferred)

---

## Phase 1 — BYOK foundation (Vertex + Anthropic)

### Objective

Enable secure per-user provider credentials and use those credentials at runtime for model calls.

### Deliverables

- BYOK credential management APIs (planned, additive):
  - `GET /api/byok/providers`
  - `PUT /api/byok/providers/:provider`
  - `POST /api/byok/providers/:provider/validate`
  - `DELETE /api/byok/providers/:provider`
- Secure credential storage in Firestore with envelope encryption via Cloud KMS.
- Runtime key resolution in server model-routing paths for `/api/analyse` and `/api/v1/verify`.
- UI support for adding, validating, rotating, and revoking Vertex/Anthropic keys.
- Signed gateway tenant identity support for Zuplo-forwarded requests.
- Additive observability for BYOK lifecycle and runtime key resolution outcomes.

### Success gates

- No provider secrets exposed in logs/responses.
- End-to-end BYOK flow succeeds for Vertex and Anthropic in UI and API paths.
- `/api/v1/verify` request/response contract remains backward compatible.
- Error handling distinguishes auth/configuration/runtime failures cleanly.

---

## Phase 1b — OpenAI expansion

### Objective

Extend BYOK to OpenAI credentials and supported OpenAI models.

### Deliverables

- Add provider support for `openai` in credential schema and runtime routing.
- OpenAI credential validation flow in BYOK APIs and UI.
- Model availability surfaced in `/api/models` with user-contextual provider access.
- Provider-specific error normalization for OpenAI authentication/rate-limit/model errors.

### Success gates

- OpenAI BYOK setup and validation works in the same UX/API flow as Phase 1 providers.
- `/api/models` accurately reflects per-user accessible providers/models.
- No regressions for Vertex/Anthropic BYOK users.

---

## Phase 1c — Additional provider expansion (plugin architecture)

### Objective

Generalize BYOK support so new providers can be added without reworking core routing/storage.

### Deliverables

- Provider plugin contract for auth config, validation, model catalog, and capability metadata.
- Initial additional providers:
  - `voyage` (embeddings-oriented provider support)
  - `xai` (Grok model support)
- Consistent cross-provider status/validation semantics in BYOK APIs/UI.
- Provider onboarding checklist and acceptance tests for future additions.

### Success gates

- At least two additional providers integrated using the plugin contract.
- New provider onboarding requires no schema redesign.
- Cross-provider error and status behavior remains consistent for users.

---

## Phase 2 — Monetization (deferred)

### Objective

Add billing only after Phases 1, 1b, and 1c are operationally stable.

### Deferred deliverables

- Subscription plans and account billing UX.
- Usage metering and invoicing workflows.
- Plan/feature gating and entitlement enforcement.

### Entry criteria

- BYOK phases complete with stable error/latency profile.
- Support load and incident rate acceptable for two consecutive weeks.
- Reliable provider-usage attribution available for billing.

---

## Security controls

- Store provider keys server-side only; never expose or echo raw key material.
- Encrypt credential payloads at rest with Cloud KMS envelope encryption.
- Restrict decrypt permissions to runtime service identity.
- Require signed tenant identity headers for gateway-forwarded API traffic.
- Log redaction and secret-pattern scanning on BYOK paths.

---

## Public API and interface notes (planned, not yet shipped)

- Planned additive endpoints:
  - `GET /api/byok/providers`
  - `PUT /api/byok/providers/:provider`
  - `POST /api/byok/providers/:provider/validate`
- Existing `/api/v1/verify` contract remains backward compatible during BYOK rollout.
- `/api/models` becomes user-contextual once BYOK is active, reflecting provider/model availability by user credentials.

---

## Non-goals

- No monetization implementation in Phases 1/1b/1c.
- No migration of archived documents (`docs/archive`).
- No breaking changes to existing verification request schema.
