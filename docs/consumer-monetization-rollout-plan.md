# Consumer Monetization + Legal Hardening Rollout

## 1. Objective
Deliver production-ready consumer monetization for SOPHIA with:
- Paddle billing (merchant of record)
- BYOK handling-fee metering (10% on eligible non-cached runs)
- Source ingestion entitlements and private/public visibility controls
- Versioned legal updates and explicit consent flows

This plan is implementation-oriented and aligned to app architecture (SvelteKit + Firestore + SurrealDB).

## 2. Commercial Model (Current Default)

### 2.1 Tiers
- Free:
  - Ingestion entitlements: `2 public/month`, `0 private`
- Pro:
  - Ingestion entitlements: `3 public` OR `1 private + 2 public`
- Premium:
  - Ingestion entitlements: `5 public` OR `1 private + 3 public`

### 2.2 BYOK Revenue
- BYOK is allowed without subscription.
- BYOK wallet is prepaid via top-ups.
- Handling fee formula on eligible non-cached BYOK runs:
  - `fee = round(currency, estimated_run_cost * 0.10)`
- Fee debits are idempotent on `query_run_id`.

### 2.3 Ingestion Cost Guardrails
- Nightly worker uses estimated cost-per-ingestion and configurable budget ceiling.
- Budget guard halts batch before exceeding configured nightly spend.

### 2.4 Future Pricing Item (Backlog)
- Add optional flat per-ingestion wallet debit for private ingestion (or all ingestion), configurable by tier/currency.
- Keep current entitlement quotas, but add preflight wallet check + explicit user price disclosure before queueing.
- Implement as a guarded rollout behind a feature flag after A/B and margin validation.

## 3. Payment Provider Review (Consumer + Metered BYOK)

### 3.1 Options
- Paddle
  - Pros: Merchant of Record (tax/VAT/sales tax handled), strong global consumer checkout, subscription + one-time flows, lower legal/ops burden.
  - Cons: Less direct control vs pure PSP; webhook/event model requires careful mapping.
- Stripe
  - Pros: Strong APIs/ecosystem, flexible ledger integrations, broad docs/community.
  - Cons: You remain merchant of record (tax/compliance burden moves to you unless adding tax products/processes).
- Polar
  - Pros: Developer-focused setup for SaaS subscriptions; simple creator workflows.
  - Cons: Historically rough edges in some billing process setups for production operational reliability.

### 3.2 Recommendation
- Primary launch choice: **Paddle**.
- Rationale: best fit for small consumer product with low-maintenance tax/compliance overhead and sufficient primitives for subscriptions + wallet top-up routing.

## 4. Implemented Data Contracts

### 4.1 Firestore Billing State
- `users/{uid}/billing/profile`
  - `tier`, `status`, `currency`, `period_end_at`
  - `paddle_customer_id`, `paddle_subscription_id`
  - `legal_terms_version`, `legal_privacy_version`
- `users/{uid}/billing/entitlements`
  - `month_key`, `public_ingest_used`, `private_ingest_used`, `byok_fee_charged_cents`
- `users/{uid}/billing/wallet`
  - `currency`, `available_cents`, `lifetime_purchased_cents`, `lifetime_spent_cents`
- `users/{uid}/billingLedger/{idempotency_key}`
  - immutable billing events for byok fee/top-up auditing

### 4.2 Surreal Source/Queue Ownership Fields
- `source` additions:
  - `visibility_scope`, `owner_uid`, `contributor_uid`, `deletion_state`
- `link_ingestion_queue` additions:
  - `visibility_scope`, `owner_uid`, `contributor_uid`, `deletion_state`

## 5. API Surface

### 5.1 Billing
- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/topups`
- `POST /api/billing/webhook`
- `GET /api/billing/entitlements`

### 5.2 Source Management
- `GET /api/sources/private`
- `DELETE /api/sources/private/:id`
- `GET /api/sources/public-contributions`

### 5.3 Analyse Request Additions
- `link_preferences[]` per URL:
  - `ingest_selected`
  - `ingest_visibility` (`public_shared` | `private_user_only`)
  - `acknowledge_public_share`

### 5.4 SSE Metadata Additions
- Billing/entitlement snapshot fields
- BYOK wallet/fee snapshot fields
- Ingestion selection/queue counts

## 6. Functional Phases

### Phase 1: Billing Core + Entitlements
- Paddle endpoints and signed webhook path
- Canonical Firestore billing profile sync
- Monthly entitlement counters and combination enforcement

### Phase 2: BYOK Metering Revenue
- Wallet balance checks (preflight for charging mode)
- 10% handling fee estimation from model cost breakdown
- Idempotent debit ledger keyed by `query_run_id`
- Shadow mode option before live charging

### Phase 3: Source Visibility + Ownership
- Queue rows capture owner/contributor and visibility
- Ingestion pipeline persists visibility metadata to `source`
- Retrieval visibility filter:
  - `public_shared` + `private_user_only` where `owner_uid == viewer_uid`
- Private delete: owner-only hard delete
- Public delete: forbidden

### Phase 4: Privacy Policy Upgrade
- Added payment and Paddle data-flow coverage
- Added BYOK wallet + handling-fee metering disclosures
- Added source visibility and retention details
- Added UK/EU/US rights baseline framing

### Phase 5: Terms Upgrade
- Subscription/top-up terms and renewal framing
- Price-change and cancellation language
- No-refund-except-law policy
- Public contribution perpetual service license
- Private/public source rights and deletion boundaries
- BYOK/ingestion acceptable-use and abuse controls

### Phase 6: Consent + Notice UX
- Subscription checkout and top-up purchase require explicit legal acceptance flags
- Ingestion public-share requires explicit per-link acknowledgment
- Legal docs now show version/effective date/changelog links

### Phase 7: Rollout + Guardrails
- Feature flags:
  - `ENABLE_BILLING`
  - `ENABLE_INGEST_VISIBILITY_MODE`
  - `ENABLE_BYOK_WALLET_CHARGING`
  - `BYOK_WALLET_SHADOW_MODE`
- Nightly ingestion budget guard
- Webhook idempotency event tracking

## 7. Prompt Pack (Execution Prompts)
- Prompt A: Implement Paddle subscription + top-up endpoints with idempotent webhook handling and Firestore billing profile sync.
- Prompt B: Implement monthly entitlement counters with exact Free/Pro/Premium combinations and analyse-flow enforcement.
- Prompt C: Implement BYOK handling-fee debit (10% of estimated run cost) from model-cost telemetry with `query_run_id` idempotency.
- Prompt D: Implement source ownership isolation and private deletion/public deletion rejection.
- Prompt E: Revise privacy policy for Paddle, wallet metering, ingestion visibility, legal bases, and retention matrix.
- Prompt F: Revise terms for subscriptions, no-refund-except-law, public contribution license, and source rights.
- Prompt G: Add legal acknowledgment UX for checkout and public sharing actions with version links.
- Prompt H: Add tests for entitlements, webhook idempotency, BYOK charging, source access control, and legal gating.

## 8. Test Matrix
- Entitlement matrix tests across all tiers and private/public combinations
- BYOK fee tests:
  - success-only charge
  - idempotent re-run behavior
  - cache replay no duplicate charge
- Webhook lifecycle/idempotency tests
- Source access/deletion authorization tests
- Analyse-route tests for ingestion preference gating and metadata
- Regression tests for query/rate-limit/history behavior

## 9. Legal/Operational Checklist Before Enabling Live Charging
- Confirm production Paddle webhook signature secret
- Verify plan price IDs and top-up price IDs for GBP/USD
- Verify legal versions in checkout payload and legal page headers
- Validate top-up to wallet ledger reconciliation
- Run charging in shadow mode for at least one release window
- Enable live BYOK charging only after shadow-mode variance review

## 10. Rollback Plan
- Disable billing flows via `ENABLE_BILLING=false`.
- Disable live BYOK charging via `ENABLE_BYOK_WALLET_CHARGING=false`.
- Keep entitlement reads active but stop enforcement if required by temporary override.
- Nightly ingestion can be budget-throttled by lowering batch size/budget envs.
