---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting reference only. Use docs/sophia/roadmap.md for the active SOPHIA roadmap.

# API Development Portal Roadmap (Zuplo + PostHog)

## Summary

SOPHIA will deliver the API developer experience using **Zuplo** for gateway + developer portal capabilities and **PostHog** for product/API analytics.
The phases remain `MVP`, `MVP+1`, `MVP+2`, and `Gold-Plated`, but implementation prioritizes managed services over bespoke portal/key infrastructure.

## Target Architecture

- **Gateway + Portal**: Zuplo
  - API key issuance/validation, quotas, rate limits, request policies
  - Public developer documentation + interactive "try it" workflows
  - Request-level visibility at gateway edge
- **Core runtime**: Existing SOPHIA backend (`/api/v1/verify`) on Cloud Run
- **Analytics**: PostHog
  - Developer funnel, docs engagement, key lifecycle, request outcomes
  - Dashboarding for activation, reliability, and retention OKRs
- **Source of truth split**:
  - Zuplo: authn/authz, traffic controls, gateway telemetry
  - PostHog: product and operational analytics layer
  - SOPHIA backend: reasoning outputs and domain logic

## Phase 1 — MVP (Managed Onboarding Core)

- Stand up Zuplo in front of `/api/v1/verify` and route all external developer traffic through gateway-managed API keys.
- Create a dedicated **SOPHIA API PostHog project** inside the existing PostHog account and use it as the telemetry source of truth.
- Publish initial developer portal in Zuplo with:
  - Quickstart
  - JSON and SSE examples
  - Error model (`application/problem+json`) and request ID guidance
- Keep existing backend contract stable; no breaking changes to verification payloads.
- Implement PostHog baseline instrumentation:
  - `developer_portal_view`
  - `developer_quickstart_view`
  - `developer_playground_request_start`
  - `developer_playground_request_success`
  - `developer_playground_request_error`
  - `developer_verify_429`
- Configure initial Zuplo policies:
  - per-key rate limiting
  - quota enforcement
  - request ID forwarding to backend

## Phase 2 — MVP+1 (Integration Velocity + Policy Hardening)

- Expand Zuplo portal content:
  - TS + Python SDK examples
  - copy-paste snippets per mode (JSON/SSE)
  - troubleshooting by error class and status code
- Move key lifecycle flows fully to Zuplo-managed developer workflows where possible (create/revoke/rotate).
- Add gateway-level safeguards:
  - idempotency policy for mutating management operations
  - IP allow/block policies for abuse control
  - stricter schema validation before backend invocation
- Expand PostHog instrumentation:
  - docs funnel steps
  - SDK language selection
  - retry and failure patterns
  - key hygiene events (rotation, revocation)

## Phase 3 — MVP+2 (Team Operations + Reliability)

- Introduce team-oriented access model via Zuplo capabilities and SOPHIA account mapping:
  - owner/developer/viewer roles
  - environment separation (`dev`, `prod`) at key/policy level
- Add usage and governance views by combining:
  - Zuplo request analytics (edge metrics)
  - PostHog product telemetry (funnel + cohort behavior)
- Add webhook-based operational workflows:
  - quota threshold alerts
  - anomaly alerts (error spikes, latency drift)
- Formalize SLO operations:
  - availability and latency targets
  - incident triage runbook keyed by gateway request IDs

## Phase 4 — Gold-Plated (Platform-Grade Developer Program)

- Deliver full developer program surface on top of Zuplo + SOPHIA backend:
  - productized plans/tiers
  - advanced usage insights
  - partner-ready onboarding paths
- Add enterprise controls:
  - policy packs per tenant/use case
  - compliance-ready audit exports
  - SLA/SLO reporting workflows
- Add advanced API products as needed (e.g. batch verification), fronted through Zuplo policy/governance layer.
- Keep versioning discipline explicit (`v1` stability, `preview` channel rules) and enforce via gateway routing policies.

## BYOK enablement backlog (pre-monetization)

BYOK (Bring Your Own Key) is a subsequent engineering stream for the platform after Vertex ingestion migration and near-term grant application work. Monetization packaging is a later phase and depends on BYOK stability.

### Phase 1 — BYOK foundation (Vertex + Anthropic)

- Add planned additive BYOK endpoints:
  - `GET /api/byok/providers`
  - `PUT /api/byok/providers/:provider`
  - `POST /api/byok/providers/:provider/validate`
  - `DELETE /api/byok/providers/:provider`
- Add secure credential vault with encryption at rest and strict secret-redaction policy.
- Add runtime credential resolution per user/provider for `/api/v1/verify` and internal model-calling paths.
- Preserve backward compatibility of existing `/api/v1/verify` request/response schema.

### Phase 1b — OpenAI expansion

- Add OpenAI credential support and validation flows.
- Extend `/api/models` to user-contextual provider/model availability once BYOK is active.
- Keep provider error handling normalized across Vertex/Anthropic/OpenAI.

### Phase 1c — Additional providers (plugin expansion)

- Introduce provider plugin architecture for adding new providers without schema redesign.
- Start with Voyage and xAI/Grok as first additional provider targets.
- Add provider conformance tests and onboarding checklist.

### Phase 2 — Monetization (deferred)

- Introduce plan packaging, metering, and billing only after Phase 1/1b/1c operational stability.
- Keep monetization work gated on reliable usage attribution and low BYOK incident rates.

## Cross-Phase Standards

- OpenAPI-first contract management for `/api/v1/verify`.
- RFC 9457-style problem details for non-2xx responses.
- OWASP API Security controls applied at gateway and backend.
- Request correlation IDs propagated gateway -> backend -> analytics.
- Backward compatibility for existing `/api/v1/verify` consumers.

## Unified OKRs

### 1) Developer activation and adoption

- Median time from first portal visit to first successful verification call
- % of new developers completing a successful call within 24h
- % of developers reaching 10+ successful calls within 7 days

### 2) Reliability and performance

- Verify API availability SLO
- p95 latency (JSON) and time-to-first-event (SSE)
- Error budget burn and incident response timing

### 3) DX quality and support efficiency

- Docs-to-success funnel completion rate
- Support tickets per active API key
- % of tickets with correlated request ID present

### 4) Security and governance adoption

- % of active keys rotated within policy window
- % of production traffic governed by team-level policies
- Unauthorized or abusive traffic blocked at gateway

### 5) Business-quality usage

- 30/90-day retained active developers
- Share of production traffic on current supported SDK versions
- Enterprise tenants receiving on-time usage/SLO reports

## Analytics Coverage (PostHog-Centric)

- **Acquisition/activation**: portal views, quickstart completion, first successful call time
- **Product usage**: endpoint/mode distribution, success/error rates, retry behavior
- **Performance**: latency buckets, SSE completion/abort, rate-limit incidence
- **Governance**: key lifecycle events, policy-triggered blocks, quota threshold breaches
- **Retention**: returning developer cohorts, key reuse patterns, time-to-production milestones

## Assumptions

- Zuplo will be the primary external gateway and developer portal surface for prototype and early scale.
- Existing PostHog account will be reused, with a dedicated SOPHIA API project inside that account.
- SOPHIA backend retains reasoning logic; gateway/portal concerns are progressively moved out of bespoke app code.
- Existing `/api/v1/verify` request/response contract remains backward compatible during migration.
