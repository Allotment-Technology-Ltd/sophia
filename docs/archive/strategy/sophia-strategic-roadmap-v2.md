---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA — Strategic Development Roadmap v2

**Date:** 8 March 2026  
**Author:** Adam Hinton (Founder) + Claude (Strategic Architecture)  
**Status:** Supersedes all prior phase plans (Phases 4–8 from ROADMAP.md)  
**Prerequisite:** Phase 3c complete, UX polish sprint shipped, pre-launch hardening in progress

---

## Strategic Context

This roadmap reflects a fundamental repositioning. SOPHIA is no longer just a philosophical reasoning engine for consumers. The strategic analysis (March 2026) identified that **reasoning quality evaluation** — whether conclusions follow from premises, whether arguments are logically sound, whether epistemic foundations hold — is a massive unmet need across legal AI ($3.1–4.6B), AI safety ($200M+ annual funding), and regulatory compliance (€3.4B EU AI Act market). No commercial product evaluates reasoning quality today.

The roadmap preserves the existing philosophical engine as the consumer-facing product AND builds toward a reasoning quality API that can serve enterprise verticals. Philosophy is the wedge, not the ceiling.

### What Exists Today (Codebase Anchor)

- **Live app** at usesophia.app with Firebase Auth (Google Sign-In)
- **Knowledge base:** ~7,500 claims from 25/27 philosophical sources in SurrealDB
- **Three-pass engine:** Gemini 2.5 Pro + Google Search grounding, streaming via SSE
- **Infrastructure:** Cloud Run + GCE VM (SurrealDB) + Firestore + Pulumi IaC
- **Stack:** SvelteKit 2 / Svelte 5 / TypeScript / Tailwind CSS
- **Auth & History:** Firebase Auth → Firestore per-user history with 30-day TTL cache

### What Does NOT Change

- SvelteKit framework, SurrealDB for graph storage, Gemini for reasoning
- Three-pass dialectical engine architecture (Analysis → Critique → Synthesis)
- Design System B (dark-first, Cormorant Garamond / JetBrains Mono)
- Firebase Auth + Firestore for consumer auth/history
- Google Cloud Run deployment with Pulumi IaC

---

## Phase Overview

| Phase | Name | Duration | Key Deliverable | Revenue Signal |
|-------|------|----------|-----------------|----------------|
| **4** | Launch & Validate | 4 weeks | Public beta live, 50+ users, ARIA application submitted | None (free) |
| **5** | Reasoning API Foundation | 6 weeks | `/api/v1/verify` endpoint, domain-agnostic claim extraction | Developer waitlist |
| **6** | Epistemic Constitution | 4 weeks | 10 executable reasoning rules, compliance report output | Grant revenue |
| **7** | Consumer Polish & Monetization | 4 weeks | Stripe billing, lens/depth selectors, feedback collection | First paying users |
| **8** | Enterprise Pilot & Domain Expansion | 8 weeks | Legal/compliance domain knowledge, 3 enterprise pilots | Enterprise LOIs |
| **9** | Platform & Scale | Ongoing | Open-source SDK, MCP integration, developer ecosystem | API revenue |

**Total estimated effort to Phase 7 (first revenue):** ~18 weeks / ~220 hours at 12 hrs/week

---

## Phase 4: Launch & Validate (Weeks 1–4)

### Objective
Get the existing philosophical engine in front of real users. Simultaneously submit the ARIA Scaling Trust grant application. This phase is about validation — does the product work, do people return, what do they ask about?

### Kill Criteria
- Fewer than 10 users complete an analysis in first 2 weeks → reassess positioning
- Average time-on-page < 30 seconds → UX problem
- Zero return users in 30 days → product-market fit failure

### Tasks

#### 4.1 Pre-Launch Hardening (Week 1)
- [ ] Complete remaining Phase 3c-D items (unit tests, integration tests, E2E)
- [ ] Error injection tests (Firestore down, SurrealDB timeout, Gemini rate limit)
- [ ] Rate limiting: 3 analyses/hour per user, 10/day (Firestore counter)
- [ ] Privacy policy and terms of service pages
- [ ] Meta tags, OpenGraph, favicon for social sharing
- [ ] Google Analytics / Plausible integration (privacy-respecting)
- [ ] Re-attempt sources 5 & 8 ingestion (or confirm substitutes adequate)

#### 4.2 ARIA Application (Week 1–2)
- [ ] Draft ARIA Scaling Trust Phase 1 application (deadline: 24 March 2026)
- [ ] Position: "Structured reasoning evaluation for trustworthy AI systems"
- [ ] Budget: £100K–300K for 12–18 months
- [ ] Emphasize: open-source epistemic constitution, reasoning quality metrics

#### 4.3 Soft Launch (Week 2–3)
- [ ] Deploy to production via GitHub Actions
- [ ] Share with 10 philosophy contacts (personal network)
- [ ] Post to r/philosophy, r/askphilosophy, r/philosophyofAI
- [ ] Post to Hacker News (Show HN)
- [ ] Twitter/X thread explaining the three-pass approach

#### 4.4 Parallel Grant Applications (Week 2–4)
- [ ] Long-Term Future Fund (LTFF) application — rolling, ~$25K median
- [ ] Emergent Ventures application — rolling, $1K–50K, 2–3 week response
- [ ] Manifund listing — immediate, AI safety regranters can fund directly
- [ ] Survival and Flourishing Fund — closes 22 April 2026

#### 4.5 Usage Instrumentation (Week 3–4)
- [ ] Log all queries (anonymized) to Firestore `analytics/` collection
- [ ] Track: query topics, completion rate, follow-up rate, time-to-first-token, pass durations
- [ ] Build simple admin analytics view (/admin/analytics)
- [ ] Weekly usage report (automated Cloud Function or manual query)

---

### Agent Prompt 4.1: Rate Limiting

```
Add per-user rate limiting to the analysis endpoint.

CONTEXT: SOPHIA is a SvelteKit app deployed on Cloud Run. Auth uses Firebase Auth
with ID tokens verified server-side in hooks.server.ts. The analysis endpoint is at
src/routes/api/analyse/+server.ts. Firestore is already configured (firebase-admin).

REQUIREMENTS:

1. Create src/lib/server/rateLimit.ts:
   - Export async function checkRateLimit(uid: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>
   - Use Firestore collection `rate_limits/{uid}`
   - Document schema: { hourly_count: number, hourly_reset: Timestamp, daily_count: number, daily_reset: Timestamp }
   - Limits: 3 analyses per hour, 10 per day
   - Use Firestore transactions to avoid race conditions
   - If document doesn't exist, create it with count=1

2. Modify src/routes/api/analyse/+server.ts:
   - Before running the engine, call checkRateLimit(locals.user.uid)
   - If not allowed, return 429 with JSON: { error: 'rate_limit', remaining: 0, resetAt: ISO string }
   - Include X-RateLimit-Remaining and X-RateLimit-Reset headers on all responses

3. Create src/lib/components/RateLimitNotice.svelte:
   - Display when API returns 429
   - Show: "You've reached your analysis limit. Next analysis available in {time}."
   - Style: Design System B — --color-warm background, --color-text-primary text, centered
   - Include a countdown timer that updates every second

4. Wire the rate limit notice into the main query UI (+page.svelte):
   - On 429 response, show RateLimitNotice instead of error state
   - Hide the submit button while rate-limited

DO NOT modify the engine.ts, the SSE streaming logic, or the auth middleware.
DO NOT use Redis or any external service — Firestore only.
```

---

### Agent Prompt 4.2: Analytics Instrumentation

```
Add usage analytics logging to SOPHIA.

CONTEXT: SvelteKit app, Firebase Auth, Firestore already configured. The analysis
endpoint streams SSE events including a final 'metadata' event with token counts
and duration. The goal is lightweight analytics — no third-party services.

REQUIREMENTS:

1. Create src/lib/server/analytics.ts:
   - Export async function logAnalysis(data: AnalyticsEvent): Promise<void>
   - AnalyticsEvent type:
     {
       uid: string;                    // Firebase UID (for per-user metrics, not PII)
       query_hash: string;             // SHA-256 of query text (not raw query — privacy)
       query_length: number;           // Character count
       lens: string | null;            // Philosophical lens if selected
       depth: string;                  // 'quick' | 'standard' | 'deep'
       completed: boolean;             // Did all 3 passes complete?
       pass_durations_ms: number[];    // [analysis_ms, critique_ms, synthesis_ms]
       total_duration_ms: number;
       total_input_tokens: number;
       total_output_tokens: number;
       claims_retrieved: number;       // From knowledge graph
       grounding_sources_count: number;// From Google Search
       is_follow_up: boolean;          // Was this a follow-up question?
       error?: string;                 // Error message if failed
       timestamp: Timestamp;
     }
   - Write to Firestore collection `analytics/{autoId}`
   - Fire-and-forget — never block the response on analytics writes

2. Modify src/routes/api/analyse/+server.ts:
   - After the engine completes (or errors), call logAnalysis() with the collected data
   - Collect pass durations by recording Date.now() at each pass_start and pass_complete event
   - If the engine errors, still log with completed: false and the error message

3. Create src/routes/admin/analytics/+page.svelte:
   - Protected by Firebase Auth admin check (same pattern as existing /admin)
   - Show summary cards: total analyses (today/week/all), unique users, avg duration
   - Show a simple bar chart of analyses per day (last 30 days) — use a basic SVG bar chart, no charting library
   - Show top 10 most common query topics (use first 50 chars of query_hash... actually, store a 'topic_hint' which is the first 3 words of the query, lowercased — enough for pattern recognition without full PII)

4. Add a link to /admin/analytics from the existing admin dashboard.

DO NOT use Google Analytics, Plausible, or any external analytics service.
DO NOT store raw query text — only hashes and topic hints.
DO NOT modify the engine or SSE streaming logic.
```

---

## Phase 5: Reasoning API Foundation (Weeks 5–10)

### Objective
Extract the core reasoning capabilities into a domain-agnostic API. This is the critical architectural move: the same three-pass engine that does philosophical analysis becomes a general-purpose reasoning evaluation service. The API accepts a claim or argument (not just a philosophical question) and returns structured reasoning analysis.

### Architecture Decision
The API is a new set of SvelteKit server routes (`/api/v1/*`) that share the engine but use domain-agnostic prompts. The consumer UI continues to use the existing `/api/analyse` endpoint with philosophy-specific prompts. Both paths share: the engine orchestrator, the SurrealDB retrieval layer, and the SSE streaming infrastructure.

### Tasks

#### 5.1 Domain-Agnostic Claim Extraction
- [ ] New prompt set: extract atomic claims from any text (not just philosophical)
- [ ] Claim types expand: empirical, causal, explanatory, normative, predictive, definitional, procedural
- [ ] Relation types expand: supports, contradicts, depends_on, refines, qualifies, assumes
- [ ] Output schema: JSON with claim text, type, scope, confidence, source span

#### 5.2 Verification Endpoint
- [ ] `POST /api/v1/verify` — accepts { question?, answer?, text? }
- [ ] Returns: structured verification result with claims, relations, and reasoning evaluation
- [ ] Streaming (SSE) and non-streaming (JSON) modes
- [ ] API key auth (separate from Firebase — simple bearer token for developers)

#### 5.3 Reasoning Quality Metrics
- [ ] Define 6 core reasoning quality dimensions:
  - Logical structure (are premises stated and connected to conclusions?)
  - Evidence grounding (are claims supported by cited evidence?)
  - Counterargument coverage (are strongest objections addressed?)
  - Scope calibration (do conclusions match evidence scope?)
  - Assumption transparency (are hidden premises surfaced?)
  - Internal consistency (do claims contradict each other?)
- [ ] Each dimension scored 0–100 with explanation
- [ ] Aggregate "reasoning quality score" with weighted components

#### 5.4 API Documentation
- [ ] OpenAPI/Swagger spec for /api/v1/verify
- [ ] Developer quickstart guide
- [ ] Example requests and responses for 5 different domains

---

### Agent Prompt 5.1: Domain-Agnostic Claim Extraction

```
Create a domain-agnostic claim extraction system for SOPHIA's reasoning API.

CONTEXT: SOPHIA currently extracts philosophical claims from text using prompts
in src/lib/server/prompts/. The existing claim types are philosophy-specific
(thesis, premise, objection, response, definition, thought_experiment, empirical,
methodological). The new system must extract claims from ANY domain — legal
arguments, policy documents, news articles, AI-generated answers, business
proposals, medical reasoning.

EXISTING FILES TO REFERENCE (do not modify):
- src/lib/types/ — existing type definitions
- src/lib/server/prompts/analysis.ts — existing philosophy prompt (for pattern reference)
- src/lib/server/engine.ts — existing engine (for integration pattern reference)

CREATE THE FOLLOWING:

1. src/lib/types/verification.ts:

   export type ClaimType =
     | 'empirical'      // Verifiable factual assertion
     | 'causal'         // X causes/leads to Y
     | 'explanatory'    // X explains Y
     | 'normative'      // X ought to be / is good/bad
     | 'predictive'     // X will happen
     | 'definitional'   // X means Y
     | 'procedural'     // X should be done via Y
     | 'comparative'    // X is more/less/better than Y
     | 'conditional';   // If X then Y

   export type ClaimScope = 'narrow' | 'moderate' | 'broad' | 'universal';

   export type RelationType =
     | 'supports'       // Provides evidence or reasoning for
     | 'contradicts'    // Provides evidence or reasoning against
     | 'depends_on'     // Logically requires (if this falls, that falls)
     | 'refines'        // Adds nuance or qualification
     | 'qualifies'      // Limits the scope of
     | 'assumes';       // Takes for granted without argument

   export interface ExtractedClaim {
     id: string;                    // Generated UUID
     text: string;                  // The atomic claim, self-contained
     claim_type: ClaimType;
     scope: ClaimScope;
     confidence: number;            // 0-1, how confident the extraction is
     source_span?: string;          // The original text this was extracted from
     source_span_start?: number;    // Character offset in original text
     source_span_end?: number;
   }

   export interface ExtractedRelation {
     from_claim_id: string;
     to_claim_id: string;
     relation_type: RelationType;
     confidence: number;            // 0-1
     rationale: string;             // Why this relation exists
   }

   export interface ExtractionResult {
     claims: ExtractedClaim[];
     relations: ExtractedRelation[];
     metadata: {
       source_length: number;
       extraction_model: string;
       extraction_duration_ms: number;
       tokens_used: { input: number; output: number };
     };
   }

   export interface VerificationRequest {
     question?: string;             // The question being answered
     answer?: string;               // The answer to verify
     text?: string;                 // General text to analyse
     domain_hint?: string;          // Optional: 'legal', 'medical', 'policy', etc.
     depth?: 'quick' | 'standard' | 'deep';
   }

   export interface ReasoningScore {
     dimension: string;
     score: number;                 // 0-100
     explanation: string;
     flagged_claims?: string[];     // Claim IDs relevant to this score
   }

   export interface VerificationResult {
     overall_score: number;         // 0-100 weighted aggregate
     scores: ReasoningScore[];
     claims: ExtractedClaim[];
     relations: ExtractedRelation[];
     supported_claims: string[];    // Claim IDs with strong support
     contested_claims: string[];    // Claim IDs with contradictions
     unsupported_claims: string[];  // Claim IDs lacking evidence
     weak_assumptions: string[];    // Claim IDs that are assumed without argument
     synthesis: string;             // Natural language summary
     sources: { url: string; title: string; relevance: string }[];
   }

2. src/lib/server/prompts/extraction.ts:

   Export a system prompt for domain-agnostic claim extraction:

   SYSTEM PROMPT CONTENT:
   "You are a precise claim extraction engine. Given any text — legal arguments,
   policy documents, news articles, AI-generated answers, business proposals,
   medical reasoning, philosophical arguments, or any other domain — you extract
   atomic claims and identify logical relations between them.

   EXTRACTION RULES:
   1. Each claim must be self-contained — understandable without the original text
   2. Each claim must be atomic — one assertion per claim, not compound
   3. Preserve the original meaning precisely — do not editorialize or strengthen/weaken
   4. Assign claim_type based on what the claim actually asserts, not the domain
   5. Assign scope conservatively — prefer 'narrow' over 'broad' when ambiguous
   6. Extract 1-3 claims per paragraph of source text (more for dense argumentation)
   7. Confidence reflects how clearly the source text states this claim (1.0 = explicit statement, 0.5 = implied, 0.3 = inferred)

   RELATION RULES:
   1. Only identify relations between claims that share a subject, concept, or proposition
   2. 'depends_on' means logical dependency — if the depended-on claim is false, the dependent claim's argument collapses
   3. 'assumes' means the claim takes something for granted that is not argued for in the text
   4. Prefer precision over recall — miss a relation rather than hallucinate one
   5. Maximum 20 relations per extraction (bound the combinatorial space)
   6. Include a rationale for every relation — one sentence explaining why this relation holds

   OUTPUT FORMAT:
   Return valid JSON matching the ExtractionResult schema. No markdown, no preamble.
   Generate UUID-style IDs for claims (e.g., 'claim_001', 'claim_002').
   "

   Export function buildExtractionUserPrompt(request: VerificationRequest): string
   - Combine the available fields (question, answer, text) into a structured input
   - If domain_hint is provided, add: "DOMAIN CONTEXT: This text is from the {domain_hint} domain. Apply domain-appropriate interpretation."

3. src/lib/server/extraction.ts:

   - Import the Vertex AI client from ./vertex.ts
   - Export async function extractClaims(request: VerificationRequest): Promise<ExtractionResult>
   - Use Gemini 2.5 Pro with JSON mode (response_mime_type: 'application/json')
   - Parse and validate the response against the ExtractionResult schema
   - Add retry logic (max 2 retries) if JSON parsing fails
   - Log token usage

DO NOT modify any existing files.
DO NOT import from or depend on the philosophy-specific prompts.
DO use the same Vertex AI client configuration as the existing engine.
```

---

### Agent Prompt 5.2: Verification Endpoint

```
Create the public reasoning verification API endpoint.

CONTEXT: SOPHIA is a SvelteKit app. The domain-agnostic claim extraction system
has been built (src/lib/server/extraction.ts, src/lib/types/verification.ts).
The existing three-pass engine is at src/lib/server/engine.ts. The new verification
endpoint should reuse the engine's three-pass architecture but with domain-agnostic
prompts and structured output.

REQUIREMENTS:

1. Create src/lib/server/apiAuth.ts:
   - Export async function verifyApiKey(request: Request): Promise<{ valid: boolean; key_id: string }>
   - Check for Authorization: Bearer <api_key> header
   - For MVP: store valid API keys in Firestore collection `api_keys/{key_id}`
     Document schema: { key_hash: string, owner_uid: string, name: string, created: Timestamp, active: boolean, usage_count: number }
   - Hash incoming key with SHA-256, compare against stored hashes
   - Never store raw API keys — only hashes
   - Rate limit: 100 requests/day per key (check Firestore counter)

2. Create src/routes/api/v1/verify/+server.ts:
   - POST endpoint accepting VerificationRequest JSON body
   - Auth: API key (via apiAuth.ts), NOT Firebase Auth
   - Validate request body with Zod schema
   - Pipeline:
     a. Extract claims from the input text (extractClaims())
     b. Run reasoning quality evaluation (new function, see step 3)
     c. If knowledge graph has relevant context, include it (optional enrichment)
     d. Return VerificationResult as JSON
   - Support streaming mode via Accept: text/event-stream header
     (same SSE format as existing /api/analyse but with verification-specific events)
   - Support JSON mode via Accept: application/json header (default)
     (waits for full completion, returns complete VerificationResult)
   - Include response headers: X-Request-Id, X-Processing-Time-Ms, X-Token-Usage

3. Create src/lib/server/reasoningEval.ts:
   - Export async function evaluateReasoning(claims: ExtractedClaim[], relations: ExtractedRelation[], request: VerificationRequest): Promise<ReasoningScore[]>
   - Use a SINGLE Gemini call (not three passes) for the evaluation
   - System prompt instructs the model to evaluate 6 dimensions:
     1. Logical Structure (0-100): Are premises stated? Do they connect to conclusions?
     2. Evidence Grounding (0-100): Are empirical/causal claims supported by cited evidence?
     3. Counterargument Coverage (0-100): Are strongest objections acknowledged?
     4. Scope Calibration (0-100): Do conclusions match the scope of evidence?
     5. Assumption Transparency (0-100): Are hidden premises surfaced?
     6. Internal Consistency (0-100): Do claims contradict each other?
   - User prompt includes the extracted claims and relations as structured context
   - Output: JSON array of ReasoningScore objects
   - Aggregate score: weighted average (Logical Structure 25%, Evidence 20%, Counterarguments 20%, Scope 15%, Assumptions 10%, Consistency 10%)

4. Create src/routes/api/v1/keys/+server.ts:
   - POST: Generate a new API key (requires Firebase Auth — admin only)
   - GET: List keys for the authenticated user
   - DELETE: Revoke a key
   - Key format: 'sk-sophia-' + 32 random hex characters
   - Return the raw key ONLY on creation (never again)

5. Update src/routes/admin/+page.svelte:
   - Add "API Keys" section showing active keys, usage counts, creation dates
   - "Generate New Key" button (shows key once, then hashes and stores)

DO NOT modify the existing /api/analyse endpoint or engine.ts.
DO NOT require Firebase Auth for /api/v1/verify — it uses API key auth.
DO use the same Vertex AI client and model configuration as the existing engine.
The verification endpoint must work independently of the philosophical knowledge base
(knowledge graph enrichment is optional/additive, not required).
```

---

### Agent Prompt 5.3: Reasoning Quality Scoring

```
Implement the reasoning quality scoring system with detailed evaluation prompts.

CONTEXT: The verification endpoint exists at /api/v1/verify. Claim extraction
produces ExtractedClaim[] and ExtractedRelation[]. Now we need the evaluation
engine that scores reasoning quality across 6 dimensions.

CREATE:

1. src/lib/server/prompts/reasoning-eval.ts:

   Export const REASONING_EVAL_SYSTEM_PROMPT:

   "You are a reasoning quality evaluator. You have been given a set of extracted
   claims and their logical relations from a piece of text. Your task is to evaluate
   the QUALITY OF THE REASONING — not whether the claims are factually true, but
   whether the argumentative structure is sound.

   Evaluate across exactly 6 dimensions. For each, provide:
   - A score from 0-100
   - A 1-2 sentence explanation justifying the score
   - IDs of any claims that are particularly relevant to this score

   DIMENSIONS:

   1. LOGICAL STRUCTURE (weight: 25%)
   Score high if: premises are explicitly stated, conclusions follow from premises,
   the argument has clear inferential steps, reasoning is traceable.
   Score low if: conclusions appear without supporting premises, logical leaps are
   present, the text asserts rather than argues, key inferential steps are missing.
   Key test: Could you reconstruct the argument as a formal syllogism?

   2. EVIDENCE GROUNDING (weight: 20%)
   Score high if: empirical and causal claims cite specific evidence, sources are
   named, evidence is relevant to the claims it supports.
   Score low if: factual claims lack citation, evidence is generic ('studies show'),
   anecdotal evidence supports universal claims, cherry-picking is apparent.
   Key test: If I removed all evidence, would the argument still make the same claims?

   3. COUNTERARGUMENT COVERAGE (weight: 20%)
   Score high if: the strongest available objections are acknowledged and addressed,
   alternative explanations are considered, the text doesn't strawman opposing views.
   Score low if: only one side is presented, objections are dismissed without engagement,
   the strongest counterargument is missing, opposing views are caricatured.
   Key test: Would a knowledgeable opponent feel their best argument was fairly represented?

   4. SCOPE CALIBRATION (weight: 15%)
   Score high if: conclusions are appropriately hedged, universal claims have universal
   evidence, narrow evidence yields narrow conclusions, uncertainty is acknowledged.
   Score low if: broad claims rest on narrow evidence, correlation is presented as
   causation, certainty language appears without matching evidence strength.
   Key test: Does the strength of the conclusion match the strength of the evidence?

   5. ASSUMPTION TRANSPARENCY (weight: 10%)
   Score high if: key assumptions are stated, value premises are explicit, conceptual
   frameworks are named, hidden premises are surfaced.
   Score low if: the argument depends on unstated assumptions, value judgments are
   disguised as facts, framework-dependent conclusions are presented as universal.
   Key test: What would someone need to already believe for this argument to work?

   6. INTERNAL CONSISTENCY (weight: 10%)
   Score high if: claims don't contradict each other, definitions are used consistently,
   the same standard is applied throughout, conclusions are compatible with premises.
   Score low if: contradictory claims coexist without acknowledgment, terms shift meaning,
   double standards are applied, early claims conflict with later conclusions.
   Key test: Can all the claims in this text be true simultaneously?

   OUTPUT FORMAT:
   Return a JSON array of exactly 6 objects, each with:
   { dimension: string, score: number, explanation: string, flagged_claims: string[] }

   Order: logical_structure, evidence_grounding, counterargument_coverage,
   scope_calibration, assumption_transparency, internal_consistency

   Be calibrated: a score of 50 means average reasoning quality. 80+ means
   genuinely strong argumentation. Below 30 means significant reasoning failures.
   Most real-world text scores between 35-65."

   Export function buildReasoningEvalUserPrompt(
     claims: ExtractedClaim[],
     relations: ExtractedRelation[],
     originalText: string
   ): string
   - Format claims as a numbered list with type and scope
   - Format relations as a list of "Claim X [relation] Claim Y (rationale)"
   - Include first 2000 characters of original text for context
   - Ask: "Evaluate the reasoning quality of the above text and extracted argument structure."

2. Update src/lib/server/reasoningEval.ts:
   - Use the new prompt
   - Parse JSON response with Zod validation
   - Calculate weighted aggregate score
   - If JSON parsing fails, retry once with a "Please return ONLY valid JSON" follow-up
   - Return ReasoningScore[] plus overall_score

3. Create src/lib/server/__tests__/reasoningEval.test.ts:
   - Test case 1: Well-structured argument (expect overall > 70)
   - Test case 2: Pure assertion with no evidence (expect evidence_grounding < 30)
   - Test case 3: One-sided argument (expect counterargument_coverage < 30)
   - Test case 4: Claim with scope mismatch (expect scope_calibration < 40)
   - Use hardcoded claim/relation arrays — do not call the LLM in tests
   - Mock the Gemini call to return predictable scores

DO NOT modify any existing prompts or the three-pass engine.
These tests verify the scoring logic and prompt formatting, not the LLM output quality.
```

---

## Phase 6: Epistemic Constitution (Weeks 11–14)

### Objective
Implement the BUILD.md's strongest idea: a small, typed, executable set of epistemic rules that evaluate whether reasoning meets basic standards of intellectual rigour. This is the key differentiator from hallucination detectors (which check facts) and bias detectors (which check fairness). The constitution checks *reasoning quality*.

### What We Take From BUILD.md
- The 10 starter epistemic rules (Evidence Requirement, Proportional Evidence, Contradiction Awareness, Alternative Hypotheses, Scope Discipline, Assumption Transparency, Correlation vs Causation, Uncertainty Signalling, Normative Bridge, Source Diversity)
- The concept of a constitutional compliance check output
- The principle that rules should be executable (testable in code), not philosophical commentary

### What We Discard From BUILD.md
- The suggestion to rebuild from scratch with Express/Fastify (we keep SvelteKit)
- The suggestion to use SQLite/Chroma for retrieval (we keep SurrealDB)
- The query-time-only graph approach (we keep the persistent knowledge graph AND add query-time analysis)
- The minimal UI approach (our Design System B is already locked and superior)

### Tasks

#### 6.1 Constitutional Rule Schema
- [ ] Define rule types in SurrealDB (or Firestore for simplicity)
- [ ] 10 starter rules with: id, name, description, applies_to (claim types), severity, test logic
- [ ] Store rules as structured data, not hardcoded conditionals

#### 6.2 Constitutional Evaluator
- [ ] Engine that takes ExtractedClaim[] + ExtractedRelation[] and returns ConstitutionalCheck
- [ ] Each rule evaluation: applicable? → satisfied/violated/uncertain
- [ ] Combine LLM judgment with deterministic checks where possible

#### 6.3 Integration
- [ ] Add constitutional check to /api/v1/verify response
- [ ] Add constitutional section to consumer UI (Phase 7 polish)
- [ ] Compliance report format for enterprise use

---

### Agent Prompt 6.1: Epistemic Constitution Implementation

```
Implement SOPHIA's epistemic constitution — a set of 10 executable reasoning rules
that evaluate whether an argument meets basic standards of intellectual rigour.

CONTEXT: SOPHIA has a claim extraction system (src/lib/types/verification.ts,
src/lib/server/extraction.ts) that produces ExtractedClaim[] and ExtractedRelation[].
The verification endpoint is at /api/v1/verify. The constitution adds a second
evaluation layer: after claims are extracted and reasoning quality is scored, the
constitutional rules check for specific reasoning failures.

This is the core differentiator. Hallucination detectors check facts. Bias detectors
check fairness. The epistemic constitution checks REASONING QUALITY — whether
arguments are well-formed, not just whether they're accurate.

CREATE:

1. src/lib/types/constitution.ts:

   export type Severity = 'critical' | 'warning' | 'info';

   export interface ConstitutionRule {
     id: string;                        // e.g., 'evidence_requirement'
     name: string;                      // e.g., 'Evidence Requirement'
     description: string;               // What the rule checks
     applies_to: ClaimType[];           // Which claim types this rule evaluates
     severity: Severity;
     deterministic_check?: boolean;     // Can this be checked without LLM?
   }

   export interface RuleEvaluation {
     rule_id: string;
     rule_name: string;
     status: 'satisfied' | 'violated' | 'uncertain' | 'not_applicable';
     severity: Severity;
     affected_claim_ids: string[];      // Which claims triggered this
     rationale: string;                 // Why this status
     remediation?: string;             // How to fix (if violated)
   }

   export interface ConstitutionalCheck {
     rules_evaluated: number;
     satisfied: RuleEvaluation[];
     violated: RuleEvaluation[];
     uncertain: RuleEvaluation[];
     not_applicable: RuleEvaluation[];
     overall_compliance: 'pass' | 'partial' | 'fail';
     // pass: 0 critical violations, ≤1 warning
     // partial: 0 critical, 2+ warnings
     // fail: 1+ critical violations
   }

2. src/lib/server/constitution/rules.ts:

   Export const EPISTEMIC_RULES: ConstitutionRule[] containing these 10 rules:

   Rule 1 — Evidence Requirement (critical)
   "A factual or empirical claim must have at least one supporting evidence passage or citation."
   Applies to: empirical, causal, predictive
   Deterministic check possible: Yes — count claims of these types with zero
   'supports' relations from other claims or cited sources.

   Rule 2 — Proportional Evidence (warning)
   "The strength of a claim must be proportional to the quality and amount of evidence."
   Applies to: empirical, causal, predictive
   Deterministic check: Partial — flag claims with scope='broad'/'universal' that have
   fewer than 2 supporting relations. LLM needed for qualitative judgment.

   Rule 3 — Contradiction Awareness (critical)
   "Reasoning must acknowledge credible contradicting evidence when present."
   Applies to: empirical, causal, explanatory, normative
   Deterministic check: Yes — if contradicts relations exist in the graph but
   the text doesn't address them, flag.

   Rule 4 — Alternative Hypotheses (warning)
   "Causal or explanatory claims should consider plausible alternative explanations."
   Applies to: causal, explanatory
   Deterministic check: No — requires LLM judgment.

   Rule 5 — Scope Discipline (critical)
   "Claims must not exceed the scope of their evidence."
   Applies to: empirical, causal, predictive
   Deterministic check: Partial — flag claims with scope > supporting claims' scope.

   Rule 6 — Assumption Transparency (warning)
   "Key hidden assumptions should be surfaced when they materially affect the conclusion."
   Applies to: all claim types
   Deterministic check: No — requires LLM judgment.

   Rule 7 — Correlation vs Causation (critical)
   "Correlational evidence must not be presented as decisive causal proof."
   Applies to: causal
   Deterministic check: Partial — flag causal claims supported only by
   empirical (correlational) evidence without causal mechanism.

   Rule 8 — Uncertainty Signalling (warning)
   "Weak or mixed evidence should be reflected in the synthesis tone."
   Applies to: all claim types
   Deterministic check: No — requires LLM judgment on tone vs evidence strength.

   Rule 9 — Normative Bridge Requirement (critical)
   "Normative conclusions must not follow directly from descriptive facts alone."
   Applies to: normative
   Deterministic check: Yes — flag normative claims that depend_on only
   empirical/causal claims with no normative premise in the chain.

   Rule 10 — Source Diversity (info)
   "Verification should not rely on a single source when broader support is needed."
   Applies to: empirical, causal, predictive
   Deterministic check: Yes — count unique sources supporting broad/universal claims.

3. src/lib/server/constitution/evaluator.ts:

   Export async function evaluateConstitution(
     claims: ExtractedClaim[],
     relations: ExtractedRelation[],
     originalText: string
   ): Promise<ConstitutionalCheck>

   Implementation:
   a. Run all deterministic checks first (Rules 1, 3, 5 partial, 7 partial, 9, 10)
      — these require NO LLM call, just graph traversal over claims and relations
   b. Collect rules that need LLM judgment (Rules 2 partial, 4, 6, 8)
   c. Make ONE Gemini call for all LLM-dependent rules (batch evaluation)
   d. Merge deterministic and LLM results
   e. Calculate overall_compliance

   The deterministic checks should be in separate pure functions:
   - checkEvidenceRequirement(claims, relations): RuleEvaluation
   - checkContradictionAwareness(claims, relations): RuleEvaluation
   - checkNormativeBridge(claims, relations): RuleEvaluation
   - checkSourceDiversity(claims, relations): RuleEvaluation

   The LLM batch evaluation prompt should include all claims, relations,
   and the specific rules being evaluated, and return a JSON array of
   RuleEvaluation objects.

4. src/lib/server/prompts/constitution-eval.ts:

   System prompt for the LLM-dependent constitutional rules:

   "You are an epistemic quality auditor. You evaluate whether reasoning
   meets specific standards of intellectual rigour.

   You will be given:
   1. A set of extracted claims with types and scopes
   2. Logical relations between those claims
   3. A set of epistemic rules to evaluate

   For each rule, determine:
   - 'satisfied': The reasoning clearly meets this standard
   - 'violated': The reasoning clearly fails this standard
   - 'uncertain': Cannot determine from available information
   - 'not_applicable': The rule doesn't apply to this text

   Be conservative: prefer 'uncertain' over false 'violated'.
   Every violation must cite specific claim IDs.
   Every violation must include a remediation suggestion.

   OUTPUT: JSON array of RuleEvaluation objects."

5. Update src/routes/api/v1/verify/+server.ts:
   - After claim extraction and reasoning quality scoring, run evaluateConstitution()
   - Add constitutional_check field to the VerificationResult response
   - Include processing time for constitutional evaluation in metadata

6. Create src/lib/server/constitution/__tests__/evaluator.test.ts:
   - Test each deterministic rule with crafted claim/relation arrays
   - Test 1: Empirical claim with no supporting relation → Rule 1 violated
   - Test 2: Contradicting claims present but addressed → Rule 3 satisfied
   - Test 3: Normative claim depending only on empirical → Rule 9 violated
   - Test 4: Broad claim from single source → Rule 10 violated (info)
   - Mock the LLM call for non-deterministic rules

DO NOT modify the existing three-pass engine or consumer-facing prompts.
DO NOT add constitutional evaluation to the consumer /api/analyse endpoint yet
(that happens in Phase 7 as a UI feature).
The constitutional evaluator must work independently — it receives claims and
relations, it does not need the knowledge graph.
```

---

## Phase 7: Consumer Polish & Monetization (Weeks 15–18)

### Objective
Bring the consumer product to paying-user quality. Add the lens selector, depth selector, feedback collection, and Stripe billing. Integrate the constitutional check into the consumer UI as a "reasoning quality" indicator.

### Tasks

#### 7.1 Lens Selector
- [ ] Implement lens modifier prompts (Utilitarian, Deontological, Virtue, Rawlsian, Care)
- [ ] UI: horizontal pill selector below query input
- [ ] Store lens choice in conversation metadata

#### 7.2 Depth Selector
- [ ] Quick (Pass 1 only, ~10s), Standard (3 passes, ~25s), Deep (3 passes + gap search, ~40s)
- [ ] UI: three-button selector alongside lens
- [ ] Adjust token limits and timeouts per depth mode

#### 7.3 Reasoning Quality Badge
- [ ] Show reasoning quality score from Phase 5 scoring on consumer analyses
- [ ] Visual: circular score badge (0-100) with color coding
- [ ] Expandable detail showing 6 dimension scores
- [ ] Constitutional violations shown as warnings (not blocking)

#### 7.4 Feedback Collection
- [ ] Thumbs up/down on each pass
- [ ] Optional comment field
- [ ] Store in Firestore: `feedback/{queryId}/{passType}`
- [ ] Admin view of feedback with filtering

#### 7.5 Stripe Integration
- [ ] Free tier: 5 analyses/day, standard depth only
- [ ] Pro tier (£7.99/month): 50 analyses/day, all depths, all lenses
- [ ] Stripe Checkout for subscription
- [ ] Webhook handler for subscription lifecycle events
- [ ] Gate features in API based on subscription status

---

### Agent Prompt 7.1: Lens & Depth Selectors

```
Add philosophical lens and analysis depth selectors to SOPHIA's consumer UI.

CONTEXT: SOPHIA is a SvelteKit app with a three-pass dialectical engine. The main
query interface is at src/routes/+page.svelte. The engine is at src/lib/server/engine.ts.
Existing prompt files are at src/lib/server/prompts/{analysis,critique,synthesis}.ts.
Design System B is locked: dark background #1A1917, Cormorant Garamond for display,
JetBrains Mono for UI elements, --color-sage (#6B8E6F) for active states.

REQUIREMENTS:

1. Create src/lib/server/prompts/lens.ts:

   Export const LENS_MODIFIERS: Record<string, string> with these entries:

   'utilitarian': "LENS: Prioritise utilitarian analysis. Centre your reasoning on
   consequences, welfare maximisation, and cost-benefit evaluation. Engage other
   frameworks where relevant but weight utilitarian considerations most heavily.
   Key thinkers: Bentham, Mill, Singer, Hare."

   'deontological': "LENS: Prioritise deontological analysis. Centre your reasoning
   on duties, rights, categorical imperatives, and the moral status of actions
   independent of consequences. Key thinkers: Kant, Korsgaard, O'Neill, Scanlon."

   'virtue': "LENS: Prioritise virtue ethics analysis. Centre your reasoning on
   character, flourishing (eudaimonia), practical wisdom (phronesis), and what a
   virtuous person would do. Key thinkers: Aristotle, MacIntyre, Foot, Hursthouse."

   'rawlsian': "LENS: Prioritise Rawlsian analysis. Centre your reasoning on justice
   as fairness, the original position, the veil of ignorance, and the difference
   principle. Key thinkers: Rawls, Freeman, Nussbaum."

   'care': "LENS: Prioritise care ethics analysis. Centre your reasoning on
   relationships, responsibility, contextual judgment, and the ethics of care and
   dependency. Key thinkers: Gilligan, Noddings, Held, Tronto."

   Export const NO_LENS = '' (empty string for no lens).

2. Create src/lib/server/prompts/depth.ts:

   Export type DepthMode = 'quick' | 'standard' | 'deep';

   Export const DEPTH_CONFIGS: Record<DepthMode, {
     passes: number;
     maxTokensPerPass: number;
     passModifier: string;
     estimatedTime: string;
   }> = {
     quick: {
       passes: 1,
       maxTokensPerPass: 800,
       passModifier: "Provide a concise analysis in under 500 words. Focus on the single
       most important philosophical dimension and the strongest argument on each side.",
       estimatedTime: '~10s'
     },
     standard: {
       passes: 3,
       maxTokensPerPass: 4096,
       passModifier: '',
       estimatedTime: '~25s'
     },
     deep: {
       passes: 3,
       maxTokensPerPass: 6000,
       passModifier: "Provide an extended analysis. Engage with more traditions and
       thinkers than usual. Include historical context for key positions. If the
       knowledge graph context is thin, note what additional sources would strengthen
       the analysis.",
       estimatedTime: '~40s'
     }
   };

3. Modify src/lib/server/engine.ts:
   - Accept lens?: string and depth?: DepthMode in the engine options
   - If lens is provided and exists in LENS_MODIFIERS, prepend the modifier to the
     analysis system prompt (before the existing prompt content)
   - Apply lens to all three passes (it affects framing throughout)
   - If depth is 'quick': run only Pass 1 with quick config
   - If depth is 'deep': increase maxTokens per pass, add deep modifier
   - Pass depth through to the SSE events so the UI knows what to expect

4. Create src/lib/components/controls/LensSelector.svelte:
   - Horizontal row of pill buttons: None | Utilitarian | Deontological | Virtue | Rawlsian | Care
   - Default: None (no lens active)
   - Active state: --color-sage background, --color-bg text
   - Inactive state: --color-border border, --color-text-secondary text
   - Font: JetBrains Mono, 12px, uppercase tracking
   - On select: dispatch 'lens-change' event with lens key
   - Accessible: proper role="radiogroup", aria-labels

5. Create src/lib/components/controls/DepthSelector.svelte:
   - Three pill buttons: Quick (~10s) | Standard (~25s) | Deep (~40s)
   - Same styling pattern as LensSelector
   - Default: Standard
   - Show estimated time in --color-text-muted below each option
   - On select: dispatch 'depth-change' event with depth key

6. Integrate into src/routes/+page.svelte:
   - Place LensSelector and DepthSelector in a row below the query input
   - On mobile: stack vertically, full-width pills
   - Include lens and depth in the POST body to /api/analyse
   - If depth is 'quick': only show one pass output section (no Critique/Synthesis headers)
   - If lens is active: show "· {Lens} lens" in --color-text-muted above Pass 1 output

DO NOT modify the existing prompt text in analysis.ts, critique.ts, synthesis.ts.
The lens and depth modifiers are PREPENDED to the existing system prompts.
DO NOT change the SSE event format — add lens and depth to the metadata event only.
```

---

### Agent Prompt 7.2: Stripe Integration

```
Add Stripe subscription billing to SOPHIA.

CONTEXT: SOPHIA is a SvelteKit app with Firebase Auth. Users authenticate via
Google Sign-In. Firestore stores user data at users/{uid}/. The app runs on
Google Cloud Run. Environment variables are injected from GCP Secret Manager.

TIERS:
- Free: 5 analyses/day, standard depth only, no lens selection
- Pro (£7.99/month): 50 analyses/day, all depths, all lenses, priority processing

REQUIREMENTS:

1. Add environment variables:
   - STRIPE_SECRET_KEY (server-side only)
   - STRIPE_WEBHOOK_SECRET (server-side only)
   - VITE_STRIPE_PUBLISHABLE_KEY (client-side)
   - STRIPE_PRO_PRICE_ID (server-side — the Stripe Price ID for the Pro plan)

2. Create src/lib/server/stripe.ts:
   - Initialize Stripe client with STRIPE_SECRET_KEY
   - Export async function getOrCreateCustomer(uid: string, email: string): Promise<string>
     — Check Firestore users/{uid} for stripe_customer_id
     — If not found, create Stripe customer and store the ID
   - Export async function getUserSubscription(uid: string): Promise<{ tier: 'free' | 'pro'; active: boolean; current_period_end?: Date }>
     — Check Firestore users/{uid} for subscription data
   - Export async function createCheckoutSession(uid: string, email: string): Promise<string>
     — Create Stripe Checkout session for Pro plan
     — success_url: /account?session_id={CHECKOUT_SESSION_ID}
     — cancel_url: /account
     — Return the session URL

3. Create src/routes/api/stripe/checkout/+server.ts:
   - POST: requires Firebase Auth
   - Creates checkout session via createCheckoutSession()
   - Returns { url: string }

4. Create src/routes/api/stripe/webhook/+server.ts:
   - POST: Stripe webhook (no Firebase Auth — verified by Stripe signature)
   - Verify webhook signature with STRIPE_WEBHOOK_SECRET
   - Handle events:
     - checkout.session.completed → update Firestore users/{uid} with subscription data
     - customer.subscription.updated → update tier and period_end
     - customer.subscription.deleted → set tier to 'free'
     - invoice.payment_failed → set subscription status to 'past_due'
   - Always return 200 (Stripe retries on failure)

5. Create src/routes/account/+page.svelte:
   - Show current plan (Free or Pro)
   - If Free: "Upgrade to Pro" button → redirects to Stripe Checkout
   - If Pro: show subscription details, next billing date
   - "Manage Subscription" link → Stripe Customer Portal
   - Show usage stats: analyses today / daily limit, analyses this month

6. Modify the rate limiting (src/lib/server/rateLimit.ts):
   - Check user's tier from Firestore
   - Free: 5/day, standard depth only
   - Pro: 50/day, all features
   - Return tier info in the rate limit response so UI can gate features

7. Modify src/routes/+page.svelte:
   - If user is on Free tier:
     - Disable lens selector (show lock icon, "Pro feature")
     - Disable Deep depth option (show lock icon)
     - Show "X/5 analyses remaining today" counter
   - If user is on Pro tier:
     - All features enabled
     - Show "X/50 analyses remaining today"
   - Show subtle "Upgrade" link in TopBar for free users

8. Create src/lib/stores/subscription.ts:
   - Svelte 5 store using $state rune
   - Export subscription state: { tier, analyses_today, daily_limit, features }
   - Sync from Firestore on auth state change

DO NOT use Stripe's client-side payment elements — use Checkout Sessions (redirect).
DO NOT store payment details in Firestore — only subscription status and Stripe IDs.
DO NOT modify the engine or prompts — billing gates happen at the API route level.
Use Stripe test mode keys during development.
```

---

## Phase 8: Enterprise Pilot & Domain Expansion (Weeks 19–26)

### Objective
Expand the knowledge base beyond philosophy into legal reasoning and regulatory compliance. Run 3 enterprise pilots targeting EU AI Act compliance, legal argument analysis, and NHS AI governance.

### Tasks

#### 8.1 Legal Reasoning Knowledge Base
- [ ] Ingest 15–20 foundational legal reasoning sources using existing pipeline
- [ ] Claim types: legal_precedent, statutory_interpretation, procedural, rights_claim
- [ ] New domain: 'legal_reasoning' in PhilosophicalDomain (rename to ReasoningDomain)

#### 8.2 Regulatory Compliance Knowledge Base
- [ ] Ingest EU AI Act key articles and recitals
- [ ] Ingest UK AI Safety Institute framework documents
- [ ] Claim types: regulatory_requirement, compliance_obligation, risk_classification

#### 8.3 Enterprise Features
- [ ] Multi-user workspaces (team accounts)
- [ ] Audit trail: every analysis logged with timestamp, user, inputs, outputs
- [ ] Export: PDF/DOCX reports of verification results + constitutional compliance
- [ ] Custom constitutional rules (enterprise customers define their own)

#### 8.4 Enterprise Pilots
- [ ] Pilot 1: EU AI Act compliance team — can SOPHIA evaluate whether an AI system's documentation meets Article 9 (Risk Management) requirements?
- [ ] Pilot 2: Law firm — can SOPHIA analyse the reasoning quality of legal briefs?
- [ ] Pilot 3: NHS AI governance — can SOPHIA evaluate AI procurement decision rationales?

---

### Agent Prompt 8.1: Domain Expansion Pipeline

```
Extend SOPHIA's ingestion pipeline to support non-philosophical domains.

CONTEXT: SOPHIA's ingestion pipeline is at scripts/ingest.ts. It currently uses
Claude Sonnet for claim extraction, relation identification, and argument grouping,
followed by Gemini validation. The pipeline writes to SurrealDB. Sources are
philosophical texts (SEP entries, philosophy papers).

The pipeline needs to ingest legal, regulatory, and policy documents using the SAME
architecture but with domain-appropriate extraction prompts.

REQUIREMENTS:

1. Create scripts/prompts/domains/ directory with domain-specific prompt files:

   scripts/prompts/domains/philosophy.ts (move existing prompts here)
   scripts/prompts/domains/legal.ts
   scripts/prompts/domains/regulatory.ts

   Each domain file exports:
   - CLAIM_EXTRACTION_PROMPT: string (domain-appropriate claim extraction instructions)
   - RELATION_EXTRACTION_PROMPT: string
   - ARGUMENT_GROUPING_PROMPT: string
   - DOMAIN_CLAIM_TYPES: string[] (valid claim types for this domain)
   - DOMAIN: string (the domain identifier)

2. For legal.ts, the claim extraction prompt should instruct:
   "Extract atomic legal claims from this document. Legal claims include:
   - legal_precedent: A principle established by prior court decisions
   - statutory_interpretation: A reading of what a statute requires or permits
   - procedural: A claim about required legal process or procedure
   - rights_claim: An assertion about legal rights or entitlements
   - factual_finding: A determination about facts relevant to legal reasoning
   - policy_rationale: The reasoning behind a legal rule or decision

   Preserve exact citations (case names, statute references, article numbers).
   Each claim must be self-contained and traceable to the source text."

3. For regulatory.ts, the claim extraction prompt should instruct:
   "Extract atomic regulatory claims from this document. Regulatory claims include:
   - regulatory_requirement: A mandatory obligation imposed by the regulation
   - compliance_obligation: A specific action required for compliance
   - risk_classification: A categorization of risk level
   - exemption: A condition under which a requirement does not apply
   - penalty: A consequence for non-compliance
   - definition: A term defined by the regulation with specific legal meaning

   Preserve exact article/recital references. Flag where requirements are conditional
   on risk classification or sector."

4. Modify scripts/ingest.ts:
   - Accept --domain flag: 'philosophy' (default), 'legal', 'regulatory'
   - Load the appropriate domain prompt file based on the flag
   - Pass domain-appropriate claim types to the extraction prompt
   - Store the domain on each claim and source record in SurrealDB
   - All other pipeline stages (embedding, validation, scoring, storage) remain identical

5. Modify scripts/ingest-batch.ts:
   - Accept --domain flag, pass through to individual ingest calls

6. Update src/lib/server/retrieval.ts:
   - Accept optional domain filter in retrieveContext()
   - If domain is specified, filter vector search results to that domain
   - If no domain specified, search across all domains (current behaviour)

7. Create scripts/sources/legal/ and scripts/sources/regulatory/ directories
   - Add README.md in each explaining the source selection criteria

DO NOT modify the core pipeline architecture (7-stage process).
DO NOT change the SurrealDB schema — add 'domain' as a field on existing claim/source tables.
DO NOT change the Gemini validation stage — it works domain-independently.
The existing philosophy pipeline must continue to work identically with --domain philosophy.
```

---

## Phase 9: Platform & Scale (Ongoing)

### Objective
Open-source the epistemic constitution, build an SDK, integrate with the LLM middleware ecosystem via MCP. Transition from product company to platform company.

### Tasks (Not Sequenced — Driven by Market Signal)

#### 9.1 Open-Source Epistemic Constitution
- [ ] Extract constitution rules, evaluator, and types into a standalone npm package
- [ ] `@sophia/epistemic-constitution` — MIT licensed
- [ ] Published to npm with TypeScript types
- [ ] Documentation site (simple, GitHub Pages)
- [ ] 10 starter rules + extensibility for custom rules

#### 9.2 MCP Integration
- [ ] SOPHIA as an MCP server: expose verify, extract_claims, evaluate_constitution as tools
- [ ] Any MCP-compatible client (Claude, Cursor, VS Code) can call SOPHIA's reasoning evaluation
- [ ] This is the highest-leverage distribution channel for the API

#### 9.3 Developer SDK
- [ ] `@sophia/sdk` — TypeScript client for the verification API
- [ ] Handles auth, streaming, retries, type safety
- [ ] Examples: LangChain integration, Guardrails AI plugin, standalone usage

#### 9.4 Batch Processing API
- [ ] `POST /api/v1/verify/batch` — accept array of texts, return array of results
- [ ] Async processing with webhook callback on completion
- [ ] For enterprise: verify entire document sets (legal filings, policy documents)

#### 9.5 Graph Visualization
- [ ] Interactive argument graph visualization for verified texts
- [ ] Claims as nodes, relations as edges, color-coded by type
- [ ] Exportable as SVG/PNG
- [ ] Embeddable widget for third-party integration

---

### Agent Prompt 9.1: MCP Server Implementation

```
Implement SOPHIA as an MCP (Model Context Protocol) server so any MCP-compatible
AI client can call SOPHIA's reasoning evaluation tools.

CONTEXT: SOPHIA has a verification API at /api/v1/verify that accepts text and
returns structured reasoning evaluation with claims, relations, reasoning quality
scores, and constitutional compliance checks. MCP is the emerging standard for
AI tool integration, adopted by Anthropic (Claude), OpenAI, and Microsoft.

REQUIREMENTS:

1. Create src/mcp/server.ts:
   - Implement an MCP server using the @modelcontextprotocol/sdk package
   - Register three tools:

   Tool 1: sophia_verify
   - Description: "Evaluate the reasoning quality of a text, argument, or AI-generated answer. Returns structured claims, logical relations, reasoning quality scores across 6 dimensions, and epistemic constitution compliance."
   - Input schema:
     {
       text: string (required) — The text to evaluate
       question: string (optional) — The question being answered (if verifying an answer)
       domain_hint: string (optional) — Domain context: 'philosophy', 'legal', 'regulatory', 'general'
       depth: string (optional) — 'quick' | 'standard' | 'deep' (default: 'standard')
     }
   - Output: Full VerificationResult as JSON

   Tool 2: sophia_extract_claims
   - Description: "Extract atomic claims and logical relations from any text. Returns structured claims with types, scopes, and confidence scores, plus typed logical relations between claims."
   - Input schema:
     {
       text: string (required)
       domain_hint: string (optional)
     }
   - Output: ExtractionResult as JSON

   Tool 3: sophia_check_constitution
   - Description: "Evaluate whether a set of claims meets epistemic quality standards using SOPHIA's 10-rule epistemic constitution. Checks evidence requirements, scope discipline, assumption transparency, and more."
   - Input schema:
     {
       text: string (required) — Original text
       claims: ExtractedClaim[] (optional) — Pre-extracted claims (skips extraction if provided)
     }
   - Output: ConstitutionalCheck as JSON

2. Create src/mcp/index.ts:
   - Entry point for running SOPHIA as a standalone MCP server
   - Accepts --port flag (default: 3001)
   - Connects to the same SurrealDB, Vertex AI, and Firestore backends as the main app

3. Add to package.json:
   - Script: "mcp": "tsx src/mcp/index.ts"
   - Script: "mcp:dev": "tsx watch src/mcp/index.ts"

4. Create docs/mcp-integration.md:
   - How to connect Claude Desktop to SOPHIA's MCP server
   - How to connect Cursor/VS Code to SOPHIA's MCP server
   - Example conversations showing MCP tool calls
   - Troubleshooting guide

5. Create a Docker configuration for running the MCP server:
   - Dockerfile.mcp (separate from the main app Dockerfile)
   - Uses the same base image and dependencies
   - Exposes port 3001
   - Reads same environment variables

DO NOT modify the main SvelteKit app or its API routes.
The MCP server reuses the same backend libraries (extraction.ts, reasoningEval.ts,
constitution/evaluator.ts) but runs as a separate process.
The MCP server does NOT require Firebase Auth — it trusts the calling client.
API key auth can be added later for hosted MCP servers.
```

---

## Grant Strategy Timeline

| Week | Application | Amount | Fit |
|------|------------|--------|-----|
| 1–2 | **ARIA Scaling Trust** (deadline 24 Mar) | £100K–300K | ★★★★★ |
| 2–3 | **LTFF** (rolling) | $20K–200K | ★★★★☆ |
| 2–3 | **Emergent Ventures** (rolling) | $1K–50K | ★★★★☆ |
| 3 | **Manifund** (immediate) | Variable | ★★★★☆ |
| 6 | **Survival & Flourishing** (22 Apr) | $50K–500K | ★★★★☆ |
| 8–10 | **Schmidt Sciences Trustworthy AI** (17 May) | Up to $5M | ★★★☆☆ |
| 8–10 | **Innovate UK Sovereign AI** (rolling) | £50K–120K | ★★★★☆ |
| 12+ | **Foresight Institute** (monthly) | $10K–100K | ★★★☆☆ |

**Target:** 3–5 small grants ($50K–150K non-dilutive) in 6 months + 1 medium grant (£100K–300K from ARIA) in 12 months, supplemented by Pro subscription and API revenue.

---

## Success Metrics by Phase

| Phase | Metric | Target |
|-------|--------|--------|
| 4 | Users who complete an analysis | 50+ |
| 4 | ARIA application submitted | ✓ |
| 4 | Return rate (30-day) | 20%+ |
| 5 | API verification endpoint live | ✓ |
| 5 | Developer waitlist signups | 25+ |
| 6 | Epistemic constitution: rules passing tests | 10/10 |
| 6 | Grant funding secured | ≥£25K |
| 7 | Paying subscribers (Pro) | 20+ |
| 7 | MRR | £160+ (20 × £7.99) |
| 8 | Enterprise pilot LOIs | 3 |
| 8 | API monthly active keys | 10+ |
| 9 | npm package weekly downloads | 100+ |
| 9 | MCP integration live | ✓ |

---

## What This Roadmap Deliberately Defers

- **Mobile app** — Web-first, responsive design handles mobile
- **Multi-language support** — English only until Phase 8+
- **Custom model fine-tuning** — Prompt engineering first, fine-tuning only if quality plateaus
- **Graph visualization** — Phase 9 (high effort, lower priority than API and billing)
- **Multi-agent orchestration** — The three-pass engine is sequential by design
- **Formal verification** — SOPHIA evaluates natural-language reasoning, not formal proofs

---

## How to Use This Document

1. **Current sprint?** Start at Phase 4 — the immediate pre-launch hardening tasks
2. **Building a feature?** Find the relevant agent prompt and paste it into Cursor or GitHub Copilot
3. **Applying for a grant?** Use the grant strategy timeline and reference the strategic analysis
4. **Talking to an investor?** The Phase 5–6 API + constitution story is the pitch
5. **Updating this doc?** Mark tasks [x] when complete, update dates, keep it living

---

## The One-Sentence Vision

**SOPHIA is the reasoning quality layer for the AI stack — the tool that evaluates whether AI-generated arguments are logically sound, not just factually accurate.**

Philosophy is the wedge. Reasoning quality is the market. The epistemic constitution is the moat.
