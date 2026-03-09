# SOPHIA Phases 4–7: Copilot Prompt Guides

**Companion to:** sophia-phase3c-ui-prompt-guide.md (Phase 3c)
**Assumes completed:** Phase 3c (UI), Phase 3b (DB persistence + ethics ingestion), Phase 3a (pipeline)
**Note:** Phases 3d–3g (domain expansion) run on the established ingestion pipeline and are covered in sophia-revised-roadmap.md. This document covers the four feature phases that follow.

---

# Phase 4: Web Search + Gap Filling + Conversation Persistence

**Goal:** When the Adversary (Pass 2) identifies a genuine knowledge gap, SOPHIA searches the web, evaluates source credibility, and injects the result into the Synthesis (Pass 3). Also: conversation persistence so users can ask follow-up questions.

**Prerequisites:** Working three-pass engine with graph context, SurrealDB running with ingested sources.

**Estimated time:** ~25 hours across 4 weeks
**Estimated cost:** £5–10/month additional (Tavily or Anthropic search API)

---

## Pre-Flight (Manual)

```bash
# Verify Phase 3 is running with graph context
curl -s https://sophia-210020077715.europe-west1.run.app/api/health | jq .
# Should show: sources > 0, claims > 0, arguments > 0

# Install search provider SDK
pnpm add tavily

# Add API key to .env
echo "TAVILY_API_KEY=your-key-here" >> .env

# Add to GCP Secret Manager
echo -n "your-tavily-key" | gcloud secrets create tavily-api-key --data-file=-
gcloud secrets add-iam-policy-binding tavily-api-key \
  --member="serviceAccount:210020077715-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Prompt 4.1: Search Provider Client (Sonnet)

```
Create src/lib/server/search.ts — the web search client for SOPHIA's gap-fill mechanism.

CONTEXT: When Pass 2 (Critique) identifies a specific knowledge gap, the engine needs to search the web for targeted information before running Pass 3 (Synthesis). This is NOT general web search — it only triggers when the Adversary says something specific is missing.

Requirements:

1. Import TAVILY_API_KEY from $env/static/private
2. Import the tavily package

3. Export async function searchForGap(query: string, options?: { maxResults?: number }): Promise<SearchResult[]>
   - Call Tavily search API with:
     - query: the gap_search_query from Pass 2
     - max_results: options?.maxResults ?? 5
     - search_depth: 'advanced'
     - include_answer: false
     - include_raw_content: false
   - Return array of SearchResult objects

4. Export interface SearchResult:
   - title: string
   - url: string
   - content: string (snippet)
   - score: number (relevance score from Tavily)

5. Error handling: If Tavily is unavailable or rate-limited, return empty array.
   Log the error but do not throw — gap search is optional, the engine continues without it.

6. Rate limit awareness: Tavily free tier = 1000 searches/month.
   Log each search call with a counter. If counter > 900 in current month, log a warning.

Cost: ~£0 (free tier). Each search is one API call.
```

**Post-execution check:** Call searchForGap('EU AI Act Article 6 classification criteria') manually and verify results return.

## Prompt 4.2: Credibility Scorer (Sonnet)

```
Create src/lib/server/credibility.ts — evaluates search results for source quality before injecting into the engine.

CONTEXT: Not all web search results are equally trustworthy for philosophical reasoning. Academic sources (SEP, PhilPapers, JSTOR) are Tier 1. Quality journalism (Guardian, BBC) is Tier 2. Blogs and opinion pieces are Tier 3. SOPHIA should prefer higher-tier sources and flag credibility.

Requirements:

1. Import the Anthropic client and MODEL from ./anthropic
2. Import the CREDIBILITY_SYSTEM prompt and CREDIBILITY_USER builder from ./prompts/credibility

3. The credibility prompt already exists in sophia-prompts-addendum.md (P4.1). Copy it exactly into src/lib/server/prompts/credibility.ts.

4. Export async function assessCredibility(gapQuery: string, searchResults: SearchResult[]): Promise<CredibilityResult>
   - Call Claude with CREDIBILITY_SYSTEM and CREDIBILITY_USER(gapQuery, JSON.stringify(searchResults))
   - Temperature: 0.1, max_tokens: 500
   - Parse JSON response
   - Return CredibilityResult

5. Export interface CredibilityResult:
   - gap_addressed: boolean
   - extracted_information: string | null
   - credibility_tier: 1 | 2 | 3
   - source_name: string
   - source_url: string
   - conflicts_found: boolean
   - conflict_note: string | null

6. If Claude returns invalid JSON, log error and return { gap_addressed: false, ... defaults }.

7. Cost: ~£0.003 per call (short input/output). Log token usage.
```

**Post-execution check:** Pass sample search results through assessCredibility and verify JSON parses correctly.

## Prompt 4.3: Modified Pass 2 with Gap Detection (Opus)

```
Modify the Pass 2 (Critique) prompt in src/lib/server/prompts/critique.ts to output structured gap detection.

CONTEXT: The Adversary now has the ability to trigger a web search by identifying a specific knowledge gap. This is NOT about finding more information generally — it is about identifying a specific claim, position, or piece of evidence that is MISSING and NEEDED.

Add this to the end of CRITIQUE_SYSTEM (after the existing critique instructions):

---

KNOWLEDGE GAP ASSESSMENT:

After completing your critique, assess whether there is a specific factual or philosophical gap that, if filled, would materially change the analysis. This is NOT about finding more information generally — it is about identifying a specific claim, position, or piece of evidence that is MISSING and NEEDED.

If such a gap exists, output at the very end of your response, separated by a line "---GAP---":

```json
{
  "gap_search_needed": true,
  "gap_search_query": "[specific search query]",
  "gap_search_reason": "[why this specific information is needed]"
}
```

If no specific gap exists, output:
```json
{"gap_search_needed": false}
```

Examples of genuine gaps:
- "The analysis assumes EU AI Act Article 6 classifies this as high-risk, but I cannot verify the specific classification criteria" → search for "EU AI Act Article 6 high-risk classification criteria"
- "The utilitarian calculus requires empirical data on outcomes that neither the knowledge base nor the analysis provides" → search for relevant empirical studies

Examples of NOT gaps (do not trigger search):
- "There are many other philosophers who discuss this topic" → too vague
- "More context would be helpful" → not actionable

---

Also modify the engine to parse this output:

In src/lib/server/engine.ts, after Pass 2 completes:
1. Check if critiqueOutput contains "---GAP---"
2. If yes, extract the JSON after the separator
3. Parse gap_search_needed, gap_search_query, gap_search_reason
4. Strip the gap JSON from the critique output (the user sees clean critique text, not the JSON)
5. Store the parsed gap info for use between Pass 2 and Pass 3

Add a new callback: onGapDetected(query: string, reason: string): void
Call it when a gap is detected, before running the search.

In +server.ts, emit a new SSE event:
data: { type: 'gap_detected', query: string, reason: string }

The UI can show this in the status bar: "Searching beyond the graph..."
```

**Post-execution check:** Submit "Is the EU AI Act's risk classification ethically justified?" — Pass 2 should detect a gap about specific classification criteria.

## Prompt 4.4: Gap Search Orchestration (Opus)

```
Modify src/lib/server/engine.ts to execute the gap-fill pipeline between Pass 2 and Pass 3.

CONTEXT: After Pass 2 completes and a gap is detected, the engine must: (1) search the web, (2) assess credibility, (3) inject the result into Pass 3's context. This all happens server-side before Pass 3 begins.

Requirements:

1. Import searchForGap from ./search
2. Import assessCredibility from ./credibility

3. After Pass 2 parsing (where gap detection already works from Prompt 4.3):

   if (gapInfo.gap_search_needed) {
     callbacks.onGapDetected(gapInfo.gap_search_query, gapInfo.gap_search_reason);

     // Step 1: Search
     const searchResults = await searchForGap(gapInfo.gap_search_query);

     // Step 2: Assess credibility
     let gapContext = '';
     if (searchResults.length > 0) {
       const credResult = await assessCredibility(gapInfo.gap_search_query, searchResults);

       if (credResult.gap_addressed && credResult.credibility_tier <= 2) {
         gapContext = `\n\nWEB SEARCH RESULT (Tier ${credResult.credibility_tier} — ${credResult.source_name}):\n` +
           `Gap filled: ${gapInfo.gap_search_query}\n` +
           `Information: ${credResult.extracted_information}\n` +
           `Source: ${credResult.source_url}\n` +
           (credResult.conflicts_found ? `Note: ${credResult.conflict_note}` : '');
       }
     }

     // Step 3: Inject into Pass 3 user prompt
     // Modify buildSynthesisUserPrompt to accept optional gapContext parameter
     // Append gapContext after the critique output in the synthesis user message
   }

4. Modify buildSynthesisUserPrompt in src/lib/server/prompts/synthesis.ts:
   - Add optional parameter: gapContext?: string
   - If provided, append after critique output:
     "\n\nADDITIONAL CONTEXT FROM WEB SEARCH:\n" + gapContext
   - Add to SYNTHESIS_SYSTEM: "If web search results are provided, evaluate their credibility
     tier and weight them accordingly. Tier 1 (academic) sources can be cited with confidence.
     Tier 2 (journalism) sources should be noted but treated with appropriate caution.
     Never cite a source you have not been given."

5. Emit SSE events for UI:
   data: { type: 'gap_searching', query: string }
   data: { type: 'gap_result', found: boolean, source?: string, tier?: number }

6. Timing: The entire gap-fill (search + credibility assessment) should take <3 seconds.
   If it takes longer, proceed to Pass 3 without the gap context.
   Use Promise.race with a 5-second timeout.

7. Cost per gap-fill: Tavily search (free) + credibility assessment (~£0.003) = ~£0.003.
   Not every analysis triggers a gap search — only when Pass 2 specifically identifies one.
```

**Post-execution check:** Full three-pass analysis where Pass 2 detects a gap should show gap_searching and gap_result SSE events, and Pass 3 should reference the web search result.

## Prompt 4.5: Conversation Persistence (Opus)

```
Add conversation persistence to SOPHIA using SurrealDB document storage.

CONTEXT: Users should be able to ask follow-up questions that build on previous analyses. Each conversation stores the full history of queries and responses, enabling contextual follow-ups like "What would a utilitarian say about that?" or "Can you go deeper on the epistemological objection?"

Requirements:

1. Create src/lib/server/conversations.ts

2. SurrealDB schema additions (add to setup-schema.ts):

   DEFINE TABLE conversation SCHEMAFULL;
   DEFINE FIELD created_at ON conversation TYPE datetime DEFAULT time::now();
   DEFINE FIELD updated_at ON conversation TYPE datetime DEFAULT time::now();
   DEFINE FIELD title ON conversation TYPE option<string>;
   DEFINE FIELD message_count ON conversation TYPE int DEFAULT 0;

   DEFINE TABLE message SCHEMAFULL;
   DEFINE FIELD conversation ON message TYPE record<conversation>;
   DEFINE FIELD role ON message TYPE string ASSERT $value IN ['user', 'assistant'];
   DEFINE FIELD content ON message TYPE string;
   DEFINE FIELD pass_outputs ON message TYPE option<object>;
   DEFINE FIELD gap_search ON message TYPE option<object>;
   DEFINE FIELD claims_extracted ON message TYPE option<array>;
   DEFINE FIELD created_at ON message TYPE datetime DEFAULT time::now();

   DEFINE INDEX idx_message_conversation ON message FIELDS conversation;

3. Export functions:
   - createConversation(): Promise<string> — creates a new conversation, returns ID
   - addMessage(conversationId, role, content, metadata?): Promise<string>
   - getConversation(conversationId): Promise<{ conversation, messages[] }>
   - getRecentConversations(limit?: number): Promise<conversation[]>

4. Modify the analysis API endpoint:
   - Accept optional conversation_id in the request body
   - If provided, load conversation history and include in the Pass 1 user prompt as context:
     "CONVERSATION HISTORY:\n" + messages.map(m => `${m.role}: ${m.content}`).join('\n')
   - If not provided, create a new conversation
   - After analysis completes, save the user message and assistant response
   - Auto-generate a title from the first query (use first 60 chars)
   - Return conversation_id in the SSE metadata event

5. Modify the SSE metadata event to include:
   data: { type: 'metadata', ..., conversation_id: string }

6. Graceful degradation: If SurrealDB is unavailable, conversations are not persisted.
   The analysis still works — it just won't have history context.

7. Context window management: Only include the last 5 message pairs in conversation history
   to avoid exceeding Claude's context window. Summarise earlier messages if needed.
```

**Post-execution check:** Submit a question, note the conversation_id, then submit a follow-up referencing the first answer. Pass 1 should show awareness of the previous exchange.

## Prompt 4.6: Conversation UI (Sonnet)

```
Add conversation persistence to the frontend UI.

CONTEXT: The backend now returns a conversation_id with each analysis. The UI needs to: (1) store it, (2) send it back on follow-ups, (3) show conversation history in the History tab.

Requirements:

1. Modify the conversation store (src/lib/stores/conversation.svelte.ts or equivalent):
   - Add conversationId: string | null to store state
   - When SSE metadata event arrives with conversation_id, store it
   - When user submits a new question, include conversation_id in the POST body
   - Add a "New conversation" action that clears conversationId

2. Modify the input form:
   - Add a "New conversation" button (small, secondary style) next to the submit button
   - Clicking it clears conversation state and resets the UI
   - Show a subtle indicator when in a continuing conversation (e.g., "Follow-up" label)

3. Wire the History tab (from Phase 3c):
   - On app load, fetch recent conversations from GET /api/conversations
   - Display in the History tab using the existing HistoryTab component
   - Clicking a history item loads that conversation's messages and sets conversationId

4. Create src/routes/api/conversations/+server.ts:
   - GET: return getRecentConversations(20) — list of recent conversations
   - Each item: { id, title, message_count, updated_at }

5. Create src/routes/api/conversations/[id]/+server.ts:
   - GET: return getConversation(id) — full conversation with messages

6. Gap search UI integration:
   - When 'gap_detected' SSE event arrives, update the status bar: "Searching beyond the graph..."
   - When 'gap_result' SSE event arrives:
     - If found: "Found: {source} (Tier {tier})" — show briefly then fade
     - If not found: "No relevant sources found" — show briefly then fade
   - Add the 'search' phase to AnalysisPhase type now (it's Phase 4):
     export type AnalysisPhase = 'analysis' | 'search' | 'critique' | 'synthesis';
```

**Post-execution check:** Submit a question, verify History tab shows it. Click the history entry, verify it loads. Submit a follow-up, verify Pass 1 references previous context.

## Prompt 4.7: Rate Limiting (Sonnet)

```
Add rate limiting to SOPHIA to prepare for multi-user access.

CONTEXT: Before Phase 5 (auth), rate limiting is IP-based. After auth, it becomes per-user. This prompt implements the foundation that Phase 5 builds on.

Requirements:

1. Create src/lib/server/ratelimit.ts

2. Simple in-memory rate limiter (upgrades to SurrealDB-backed in Phase 5):
   - Track requests per IP address in a Map
   - Free tier: 3 analyses per day (per IP)
   - Window: rolling 24 hours
   - Clean up expired entries every hour

3. Export function checkRateLimit(ip: string): { allowed: boolean, remaining: number, resetAt: Date }

4. In src/routes/api/analyse/+server.ts:
   - Before starting analysis, check rate limit
   - If not allowed, return 429 with JSON: { error: 'rate_limit_exceeded', remaining: 0, resetAt: ISO date }
   - Include X-RateLimit-Remaining and X-RateLimit-Reset headers on all responses

5. In the frontend, handle 429 responses:
   - Show a user-friendly message: "You've reached the daily limit. Resets at {time}."
   - Style it using the design system (--color-copper for warning)
   - Don't show a raw error

6. Log rate limit hits to console with IP (hashed for privacy).
```

**Post-execution check:** Make 4 requests from the same IP. Fourth should return 429 with a clear message.

## Phase 4 Deploy

```bash
git add -A
git commit -m "feat: Phase 4 — web search gap-fill, conversation persistence, rate limiting

- Pass 2 gap detection: Adversary identifies specific knowledge gaps
- Tavily web search integration with 5-second timeout
- Source credibility assessment (Tier 1/2/3)
- Gap context injection into Pass 3
- Conversation persistence in SurrealDB
- Follow-up questions with conversation history
- History tab wired to real conversations
- IP-based rate limiting (3/day free tier)
- Gap search UI: status bar shows search progress"

git push origin main
```

**Phase 4 Quality Gates:**
- Gap detection triggers on ≥2 out of 5 test queries with factual gaps
- Credibility assessment correctly tiers SEP (Tier 1) vs blog (Tier 3) sources
- Follow-up questions reference previous analysis context
- Rate limit enforces 3/day and returns clear 429 message

---

# Phase 5: Auth, Polish & Beta

**Goal:** Production-ready for beta users. Authentication, per-user rate limiting, lens/depth selectors, feedback collection. Invite 20–50 beta testers.

**Prerequisites:** Phase 4 complete (conversations, gap search, rate limiting).

**Estimated time:** ~30 hours across 4 weeks
**Estimated cost:** £20–35/month (hosting + API)

---

## Pre-Flight (Manual)

```bash
# Install auth dependencies
pnpm add @auth/core @auth/sveltekit

# If using Google OAuth:
# 1. Go to console.cloud.google.com → APIs & Services → Credentials
# 2. Create OAuth 2.0 Client ID (Web application)
# 3. Authorized redirect URI: https://sophia-210020077715.europe-west1.run.app/auth/callback/google
# 4. Also add http://localhost:5173/auth/callback/google for dev

# Add to .env:
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "AUTH_GOOGLE_ID=your-google-client-id" >> .env
echo "AUTH_GOOGLE_SECRET=your-google-client-secret" >> .env

# Add secrets to GCP
echo -n "$(openssl rand -base64 32)" | gcloud secrets create auth-secret --data-file=-
echo -n "your-google-id" | gcloud secrets create auth-google-id --data-file=-
echo -n "your-google-secret" | gcloud secrets create auth-google-secret --data-file=-
```

---

## Prompt 5.1: Auth.js Integration (Opus)

```
Add authentication to SOPHIA using Auth.js (SvelteKit adapter).

CONTEXT: SOPHIA needs user accounts for per-user rate limiting, conversation ownership, and feedback collection. Start with Google OAuth + email magic links. Keep it simple.

Requirements:

1. Create src/hooks.server.ts:
   - Import SvelteKitAuth from @auth/sveltekit
   - Import Google provider from @auth/sveltekit/providers/google
   - Configure with AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET from $env/static/private
   - Export handle

2. Create src/auth.ts (or integrate into hooks):
   - Session callback: include user.id and user.email in the session
   - Sign-in callback: create or update user record in SurrealDB on first login

3. SurrealDB schema for users:

   DEFINE TABLE user SCHEMAFULL;
   DEFINE FIELD email ON user TYPE string;
   DEFINE FIELD name ON user TYPE option<string>;
   DEFINE FIELD image ON user TYPE option<string>;
   DEFINE FIELD tier ON user TYPE string DEFAULT 'free';
   DEFINE FIELD analyses_this_month ON user TYPE int DEFAULT 0;
   DEFINE FIELD created_at ON user TYPE datetime DEFAULT time::now();
   DEFINE FIELD last_active ON user TYPE datetime DEFAULT time::now();
   DEFINE INDEX idx_user_email ON user FIELDS email UNIQUE;

4. Modify conversation table to link to user:
   DEFINE FIELD user ON conversation TYPE option<record<user>>;

5. Create src/routes/auth/+page.svelte — a minimal sign-in page:
   - SOPHIA branding (TopBar)
   - "Sign in with Google" button
   - Brief tagline: "Structured philosophical reasoning for difficult questions"
   - Design System B styling (dark bg, Cormorant Garamond)

6. Protect the analysis endpoint:
   - In +server.ts, check session. If no session, return 401.
   - Allow unauthenticated access to a GET /api/health endpoint.

7. Show user info in the Settings tab:
   - Email, tier (Free/Pro), analyses remaining this month
   - Sign out button

8. Graceful degradation: If Auth.js is misconfigured (missing env vars), the app should
   fall back to unauthenticated mode (Phase 4 behaviour). Log a warning.
```

**Post-execution check:** Sign in with Google. Verify user record created in SurrealDB. Verify session persists across page reloads.

## Prompt 5.2: Per-User Rate Limiting (Sonnet)

```
Upgrade the IP-based rate limiter (Phase 4) to per-user rate limiting backed by SurrealDB.

CONTEXT: Now that users have accounts, rate limits are per-user, not per-IP. The user table already has analyses_this_month and tier fields.

Requirements:

1. Modify src/lib/server/ratelimit.ts:

   - Export async function checkUserRateLimit(userId: string): Promise<RateLimitResult>
   - Query SurrealDB: SELECT tier, analyses_this_month FROM user WHERE id = $userId
   - Tier limits:
     - free: 3 analyses per month
     - pro: unlimited (return { allowed: true, remaining: Infinity })
   - Return { allowed, remaining, resetAt: first of next month }

   - Export async function incrementUsage(userId: string): Promise<void>
   - UPDATE user SET analyses_this_month += 1, last_active = time::now() WHERE id = $userId

   - Export async function resetMonthlyUsage(): Promise<void>
   - UPDATE user SET analyses_this_month = 0 WHERE analyses_this_month > 0
   - (Call this via a cron job or Cloud Scheduler on the 1st of each month)

2. Modify the analysis endpoint to use checkUserRateLimit(session.user.id) instead of IP-based check.

3. Keep the IP-based fallback for unauthenticated requests (in case auth is disabled).

4. Show remaining analyses in the UI:
   - In the Settings tab: "Analyses remaining: {remaining} of {limit} this month"
   - After each analysis: update the displayed count
   - When limit reached: disable the submit button, show upgrade message
```

## Prompt 5.3: Lens Selector (Sonnet)

```
Add the philosophical lens selector to the UI and engine.

CONTEXT: Users can choose to emphasise a specific philosophical framework. The lens modifiers already exist in sophia-prompts-addendum.md (P5.1). This prompt wires them into the UI and engine.

Requirements:

1. Copy the LENS_MODIFIERS and NO_LENS from the prompts addendum into src/lib/server/prompts/lens.ts (already specified in P5.1).

2. Modify the engine:
   - Accept lens?: string in the analysis options
   - If lens is provided and exists in LENS_MODIFIERS, prepend the modifier to ANALYSIS_SYSTEM
   - Pass the lens through to all three passes (it affects framing throughout)

3. Add lens selector to the UI:
   - Below the query input, add a horizontal pill selector:
     None | Utilitarian | Deontological | Virtue | Rawlsian | Care
   - Default: None
   - Style: Design System B — monospace labels, --color-border pills, --color-sage for active
   - Include lens in the POST body to /api/analyse

4. Show the active lens in the analysis output header:
   - If a lens is active: "Analysis · Utilitarian lens" in --color-muted text above Pass 1
   - If no lens: show nothing extra

5. Store lens choice in conversation metadata so follow-ups maintain the same lens.
```

**Post-execution check:** Select "Utilitarian" lens, ask "Is climate activism morally obligatory?" — Pass 1 should centre utilitarian frameworks while still engaging others.

## Prompt 5.4: Depth Selector (Sonnet)

```
Add the depth selector to the UI and engine.

CONTEXT: Users can choose analysis depth. The depth configs already exist in sophia-prompts-addendum.md (P5.2). Wire them in.

Requirements:

1. Copy DEPTH_CONFIGS from prompts addendum into src/lib/server/prompts/depth.ts.

2. Modify the engine:
   - Accept depth?: DepthMode in analysis options (default: 'standard')
   - If 'quick': run only Pass 1, with passModifier prepended to system prompt, max_tokens: 600
   - If 'standard': run all three passes normally
   - If 'deep': run all three passes with higher token limits, AND enable gap search (set includeGapSearch)

3. Add depth selector to the UI:
   - Next to the lens selector, add three buttons:
     Quick (~10s) | Standard (~25s) | Deep (~40s)
   - Default: Standard
   - Style: same pill style as lens selector
   - Include depth in the POST body

4. Quick mode UI adaptations:
   - Only show one pass output (no Critique/Synthesis headers)
   - References panel still populates from the single pass extraction
   - Status bar: "Quick take complete" instead of "Analysis complete"

5. Deep mode UI adaptations:
   - Show a "Searching..." indicator between Pass 2 and Pass 3 if gap search triggers
   - Allow longer response time without timeout
```

## Prompt 5.5: Feedback Collection (Sonnet)

```
Add feedback collection — thumbs up/down on each pass, with optional comment.

CONTEXT: User feedback is critical for improving prompts. Each pass gets its own feedback. The feedback classification prompt already exists in the prompts addendum (P5.3).

Requirements:

1. SurrealDB schema:

   DEFINE TABLE feedback SCHEMAFULL;
   DEFINE FIELD user ON feedback TYPE record<user>;
   DEFINE FIELD conversation ON feedback TYPE record<conversation>;
   DEFINE FIELD pass ON feedback TYPE string ASSERT $value IN ['analysis', 'critique', 'synthesis'];
   DEFINE FIELD rating ON feedback TYPE string ASSERT $value IN ['up', 'down'];
   DEFINE FIELD comment ON feedback TYPE option<string>;
   DEFINE FIELD classification ON feedback TYPE option<object>;
   DEFINE FIELD created_at ON feedback TYPE datetime DEFAULT time::now();

2. Create src/routes/api/feedback/+server.ts:
   - POST: accept { conversation_id, pass, rating, comment? }
   - Store in SurrealDB
   - If rating === 'down', asynchronously classify using the feedback prompt (P5.3)
     with Claude Haiku (cheapest model). Store classification result.
   - Return 200

3. Add feedback UI to each pass output:
   - After each pass text, show two small icons: 👍 👎 (or SVG equivalents in design system style)
   - On thumbs down: expand a small text input for optional comment, then a "Submit" button
   - On thumbs up: just send immediately, show brief "Thanks" confirmation
   - Style: subtle, --color-dim icons, --color-sage on hover/active
   - Each pass can only be rated once per analysis

4. Create a simple admin view at /admin/feedback (dev-only, behind import.meta.env.DEV):
   - List recent feedback with classification categories
   - Filter by pass, rating, classification category
   - This is for prompt improvement — you review it manually
```

## Prompt 5.6: Beta Launch Preparation (Sonnet)

```
Prepare SOPHIA for beta launch with 20-50 invited users.

Requirements:

1. Create a beta invite system:
   - Add field 'beta_invited: boolean DEFAULT false' to user table
   - Add field 'invite_code: option<string>' to user table
   - Create a middleware that checks: if user exists but beta_invited is false,
     redirect to a "Request access" page
   - Generate 50 invite codes (random 8-char alphanumeric)
   - Store in a SurrealDB table: beta_invite { code, used: false, used_by: option<record<user>> }

2. Create src/routes/invite/+page.svelte:
   - Input field for invite code
   - On valid code: mark user as beta_invited, mark code as used
   - On invalid: "This invite code is not valid"

3. Create src/routes/request-access/+page.svelte:
   - "SOPHIA is in private beta. Enter your invite code below, or request access."
   - Invite code input
   - "Request access" button that logs the email to a waitlist table

4. Landing page at src/routes/+page.svelte for unauthenticated users:
   - Brief product description (use the executive summary language)
   - "Sign in" button
   - Design System B styling
   - Do NOT show the analysis UI to unauthenticated users

5. Create scripts/generate-invites.ts:
   - Generates N invite codes and stores in SurrealDB
   - Outputs the codes to console for manual distribution
   - Usage: pnpm tsx scripts/generate-invites.ts 50
```

## Phase 5 Deploy

```bash
git add -A
git commit -m "feat: Phase 5 — auth, per-user limits, lens/depth selectors, feedback, beta

- Google OAuth via Auth.js
- Per-user rate limiting (3/month free, unlimited pro)
- Philosophical lens selector (5 frameworks + none)
- Depth selector (quick/standard/deep)
- Feedback collection with auto-classification
- Beta invite system with 50 codes
- Landing page for unauthenticated visitors
- User settings showing tier and usage"

git push origin main
```

**Phase 5 Quality Gates:**
- Auth works on desktop and mobile (Google sign-in)
- Rate limiting correctly enforces free tier (3/month)
- Lens selector produces noticeably different analyses for same query
- Depth selector: quick ~10s (1 pass), standard ~25s (3 pass), deep ~40s (3 pass + gap)
- Feedback mechanism captures ratings on every analysis
- 20+ beta users invited with structured feedback form

---

# Phase 6: Commercial Features

**Goal:** Revenue generation through Stripe subscriptions and institutional access.

**Prerequisites:** Phase 5 complete (auth, beta users providing feedback).

**Estimated time:** Ongoing
**Estimated cost:** Stripe fees (2.9% + 30p per transaction)

---

## Pre-Flight (Manual)

```bash
# Create Stripe account at stripe.com
# Get API keys from Stripe Dashboard → Developers → API keys

pnpm add stripe @stripe/stripe-js

# Add to .env
echo "STRIPE_SECRET_KEY=sk_test_..." >> .env
echo "STRIPE_PUBLISHABLE_KEY=pk_test_..." >> .env
echo "STRIPE_WEBHOOK_SECRET=whsec_..." >> .env
echo "STRIPE_PRO_PRICE_ID=price_..." >> .env

# Create products in Stripe Dashboard:
# Product: "SOPHIA Pro"
# Price: £8/month (recurring)
# Get the price_id

# Add to GCP secrets
for SECRET in stripe-secret-key stripe-webhook-secret stripe-pro-price-id; do
  echo -n "value" | gcloud secrets create $SECRET --data-file=-
done
```

---

## Prompt 6.1: Stripe Integration (Opus)

```
Add Stripe subscription billing to SOPHIA.

CONTEXT: Free tier = 3 analyses/month. Pro = £8/month, unlimited analyses. This prompt handles checkout, webhook processing, and tier management.

Requirements:

1. Create src/lib/server/stripe.ts:
   - Import Stripe from 'stripe'
   - Import STRIPE_SECRET_KEY from $env/static/private
   - Export const stripe = new Stripe(STRIPE_SECRET_KEY)
   - Export async function createCheckoutSession(userId: string, email: string): Promise<string>
     - Create a Stripe Checkout Session with:
       - mode: 'subscription'
       - price: STRIPE_PRO_PRICE_ID
       - success_url: '{origin}/settings?upgraded=true'
       - cancel_url: '{origin}/settings'
       - client_reference_id: userId
       - customer_email: email
     - Return the session URL
   - Export async function createPortalSession(stripeCustomerId: string): Promise<string>
     - Create a Stripe Billing Portal session for managing subscription
     - Return the portal URL

2. Create src/routes/api/stripe/checkout/+server.ts:
   - POST: create checkout session, return { url }
   - Requires authentication

3. Create src/routes/api/stripe/portal/+server.ts:
   - POST: create portal session, return { url }
   - Requires authentication and existing stripeCustomerId on user record

4. Create src/routes/api/stripe/webhook/+server.ts:
   - POST: handle Stripe webhook events
   - Verify webhook signature using STRIPE_WEBHOOK_SECRET
   - Handle events:
     - checkout.session.completed: Set user tier to 'pro', store stripe_customer_id
     - customer.subscription.deleted: Set user tier to 'free'
     - customer.subscription.updated: Handle plan changes
     - invoice.payment_failed: Log warning, user keeps pro until end of period
   - Return 200 for handled events, 400 for unknown

5. Add to user table:
   DEFINE FIELD stripe_customer_id ON user TYPE option<string>;
   DEFINE FIELD subscription_status ON user TYPE option<string>;
   DEFINE FIELD subscription_end ON user TYPE option<datetime>;

6. Modify rate limiting to check tier from user record (already done in 5.2).

7. Add upgrade UI in Settings tab:
   - If tier === 'free': show "Upgrade to Pro — £8/month" button that calls checkout endpoint
   - If tier === 'pro': show "Manage subscription" button that opens Stripe Portal
   - Show current tier badge next to email
```

**Post-execution check:** Use Stripe test mode. Complete a checkout. Verify user tier updates to 'pro'. Verify rate limit removed.

## Prompt 6.2: Export Functionality (Sonnet)

```
Add export capabilities — users can download their analysis as PDF or structured JSON.

Requirements:

1. Create src/routes/api/export/[conversationId]/+server.ts:
   - Accept format query parameter: ?format=pdf or ?format=json
   - Load conversation from SurrealDB
   - For JSON: return the raw conversation data (messages, claims, relations, metadata)
   - For PDF: generate a formatted PDF using the approach below

2. PDF generation (use pdfkit or similar):
   - Title: the user's original question
   - Metadata: date, lens (if any), depth mode
   - Three sections: Analysis, Critique, Synthesis
   - Claims referenced section at the end (from references panel data)
   - Sources cited section
   - SOPHIA branding in the footer
   - Design System B typography: Cormorant Garamond for headings, system serif for body

3. Add export buttons to the UI:
   - After analysis completes, show "Export" dropdown in the main content area
   - Options: "Download PDF" and "Download JSON"
   - Style: subtle, --color-dim text, appears only after synthesis complete

4. For Pro users only — free tier sees "Upgrade to export".
```

## Prompt 6.3: Usage Analytics (Sonnet)

```
Add a usage analytics dashboard for monitoring system health and user patterns.

Requirements:

1. SurrealDB schema:

   DEFINE TABLE analytics_event SCHEMAFULL;
   DEFINE FIELD event_type ON analytics_event TYPE string;
   DEFINE FIELD user ON analytics_event TYPE option<record<user>>;
   DEFINE FIELD metadata ON analytics_event TYPE object;
   DEFINE FIELD created_at ON analytics_event TYPE datetime DEFAULT time::now();
   DEFINE INDEX idx_analytics_type ON analytics_event FIELDS event_type;
   DEFINE INDEX idx_analytics_date ON analytics_event FIELDS created_at;

2. Log events:
   - analysis_started: { query_length, lens, depth, has_conversation }
   - analysis_completed: { duration_ms, tokens_used, gap_search_triggered, passes_run }
   - feedback_submitted: { pass, rating }
   - user_signed_up, user_upgraded, user_churned

3. Create /admin/analytics (dev-only or admin-only route):
   - Total analyses this week/month
   - Active users (analysed in last 7 days)
   - Average tokens per analysis
   - Gap search trigger rate
   - Feedback sentiment breakdown
   - Most common lens/depth selections
   - Display using simple charts (recharts or Chart.js)

4. Create scripts/analytics-report.ts:
   - Run monthly: outputs a summary to console + saves to data/reports/
   - Useful for checking API spend trends before they become expensive
```

## Phase 6 Deploy

```bash
git add -A
git commit -m "feat: Phase 6 — Stripe billing, export, analytics

- Stripe subscription checkout (£8/month Pro tier)
- Webhook handling for subscription lifecycle
- Billing portal for self-service management
- PDF and JSON export (Pro only)
- Usage analytics dashboard
- Event logging for all key user actions"

git push origin main

# IMPORTANT: Set up Stripe webhook in production
# In Stripe Dashboard → Developers → Webhooks:
# Endpoint URL: https://sophia-210020077715.europe-west1.run.app/api/stripe/webhook
# Events: checkout.session.completed, customer.subscription.deleted,
#          customer.subscription.updated, invoice.payment_failed
```

---

# Phase 7: Advanced Features (Data-Driven)

**Goal:** Features built only if justified by usage data and user demand from beta.

**Prerequisites:** Phase 6 live with paying users. Usage data available.

**Important:** Each 7.x feature is independent. Build only the ones that user data supports.

---

## Prompt 7.1: Argument Graph Visualisation (Sonnet/Opus)

**Build if:** Users report difficulty understanding claim relationships, or the references panel isn't surfacing the graph structure effectively.

```
Add an interactive argument graph visualisation to SOPHIA using D3.js.

CONTEXT: SOPHIA's argument graph stores claims linked by typed relations. Users should be able to see this structure visually — which claims support or contradict each other, which arguments they belong to, and how the graph was traversed for their query.

Requirements:

1. Create src/lib/components/references/GraphView.svelte:
   - Import D3.js (already available in the project)
   - Render a force-directed graph where:
     - Nodes = claims (coloured by badge type, sized by relevance score)
     - Edges = relations (coloured by type: sage for supports, copper for contradicts,
       blue for responds-to, amber for depends-on)
     - Argument clusters shown as translucent containing shapes
   - Interactive: click a node to see claim detail (same expand/collapse as ClaimCard)
   - Zoom and pan with touch/mouse
   - Highlight the traversal path: which seed claims were found by vector search,
     and which were reached by graph traversal (different node border style)

2. Add a third view option to ViewToggle: Claims | Sources | Graph
   - Graph view renders GraphView.svelte
   - Data comes from the same referencesStore.activeClaims + their relations

3. Animation: nodes appear progressively as claims arrive from SSE,
   edges animate in when relations resolve (matching the existing stagger timing)

4. Performance: limit to 50 nodes maximum. If more claims exist, show the
   top 50 by relevance and add a "Show all" option.

5. Mobile: force-directed graph on mobile is awkward. On <768px, show a
   simplified tree layout instead (vertical, top-to-bottom).

6. Design System B: dark background (#1A1917), node labels in JetBrains Mono,
   edges with 0.3 opacity, highlighted edges at 0.8 opacity.
```

## Prompt 7.2: Batch Analysis API (Sonnet)

**Build if:** Institutional customers request it, or you're pursuing the education pilot market.

```
Add a batch analysis endpoint for processing multiple questions at once.

CONTEXT: Institutional users (philosophy departments, ethics committees) may want to analyse a set of questions in bulk — e.g., a list of case studies for a course. This runs analyses asynchronously and emails results.

Requirements:

1. Create src/routes/api/batch/+server.ts:
   - POST: accept { queries: string[], lens?: string, depth?: DepthMode }
   - Maximum 20 queries per batch
   - Pro tier only (return 403 for free users)
   - Create a batch record in SurrealDB with status 'pending'
   - Return { batch_id, status: 'pending', estimated_minutes }

2. Create src/lib/server/batch.ts:
   - Process each query sequentially (not parallel — respect API rate limits)
   - 2-second delay between analyses
   - Update batch record after each query: { completed: N, total: M, status: 'processing' }
   - On completion: status 'complete', store all results

3. Create src/routes/api/batch/[id]/+server.ts:
   - GET: return batch status and results (if complete)

4. SurrealDB schema:

   DEFINE TABLE batch SCHEMAFULL;
   DEFINE FIELD user ON batch TYPE record<user>;
   DEFINE FIELD queries ON batch TYPE array;
   DEFINE FIELD lens ON batch TYPE option<string>;
   DEFINE FIELD depth ON batch TYPE string DEFAULT 'standard';
   DEFINE FIELD status ON batch TYPE string DEFAULT 'pending';
   DEFINE FIELD completed ON batch TYPE int DEFAULT 0;
   DEFINE FIELD results ON batch TYPE option<array>;
   DEFINE FIELD created_at ON batch TYPE datetime DEFAULT time::now();

5. Add a minimal batch UI at /batch:
   - Textarea for pasting questions (one per line)
   - Lens and depth selectors
   - Submit button → shows progress bar
   - Download all results as JSON when complete

6. Cost awareness: A 20-question batch at standard depth costs ~£0.76 in API calls.
   Log the cost prominently. Add a confirmation step before submitting batches > 10.
```

## Prompt 7.3: Custom Knowledge Bases (Opus)

**Build if:** Enterprise customers want to add their own source material (institutional ethics policies, course reading lists, etc.).

```
Allow institutional users to upload and ingest their own source documents into a private argument graph partition.

CONTEXT: An ethics committee might want SOPHIA to reason from their own internal policies alongside the public philosophical knowledge base. A philosophy department might want to add their course reading list.

Requirements:

1. Add a namespace system to the argument graph:
   - Add field 'namespace' to claim, source, and argument tables: TYPE string DEFAULT 'public'
   - Public namespace: the shared knowledge base (Phases 3a-3f)
   - Custom namespaces: per-organisation, named by org ID
   - Retrieval queries filter by: public + user's org namespace

2. Create src/routes/api/sources/upload/+server.ts:
   - POST: accept file upload (PDF, TXT, MD) + metadata (title, author, year)
   - Maximum file size: 100KB of text content
   - Run the five-stage ingestion pipeline on the uploaded text
   - Store results in the user's org namespace
   - Enterprise tier only

3. Create /settings/sources — a page for managing custom sources:
   - List uploaded sources with claim counts
   - Delete source (removes all associated claims, relations, arguments)
   - Upload new source form

4. Modify retrieval to include custom namespace:
   - retrieveArgumentContext(queryEmbedding, { namespaces: ['public', orgNamespace] })

5. Cost: Each uploaded source costs ~£0.03 to ingest (Claude extraction + embeddings).
   Limit: 50 custom sources per org on Enterprise tier.

6. Security: Custom sources are NEVER shared across organisations.
   Query isolation is enforced at the SurrealDB query level with WHERE namespace IN [...].
```

## Prompt 7.4: Institutional API Access (Sonnet)

**Build if:** You have enterprise interest and need to provide programmatic access.

```
Create a REST API for institutional customers to integrate SOPHIA into their own tools.

Requirements:

1. Create API key management:
   - Add field 'api_keys' to user table: TYPE option<array>
   - Each key: { key_hash, name, created_at, last_used, active }
   - Generate keys as: sophia_[env]_[random 32 chars]
   - Store only the hash (SHA-256). Show the full key only once on creation.

2. Create src/routes/api/v1/analyse/+server.ts:
   - POST with Authorization: Bearer sophia_...
   - Accept: { query, lens?, depth?, conversation_id? }
   - Return JSON (not SSE): { analysis, critique, synthesis, claims, metadata }
   - Apply per-key rate limits (Enterprise tier: 100/day)

3. Create src/routes/api/v1/conversations/+server.ts:
   - GET: list conversations for this API key's user
   - GET /[id]: get conversation detail

4. Create /settings/api — API key management page:
   - Generate new key (show once, then only last 4 chars)
   - Revoke key
   - Show usage per key

5. API documentation:
   - Create /docs/api — a static page with API reference
   - Cover: authentication, endpoints, request/response formats, rate limits, error codes
   - Include curl examples

6. Enterprise tier only. Free and Pro users see "Contact us for API access."
```

## Phase 7 Deploy (per feature)

Each 7.x feature ships independently:

```bash
# Example for 7.1
git add -A
git commit -m "feat: Phase 7.1 — argument graph visualisation

- D3.js force-directed graph in references panel
- Nodes coloured by claim type, edges by relation type
- Progressive animation as claims arrive via SSE
- Simplified tree layout on mobile
- Third view option: Claims | Sources | Graph"

git push origin main
```

---

## Complete Phase Summary

| Phase | Prompts | Est. Time | Key Deliverable |
|-------|---------|-----------|-----------------|
| **4** (Web Search) | 7 prompts | ~25 hrs | Gap-fill pipeline, conversations, rate limiting |
| **5** (Auth + Beta) | 6 prompts | ~30 hrs | Auth, lens/depth, feedback, 50 beta users |
| **6** (Commercial) | 3 prompts | ~20 hrs | Stripe billing, export, analytics |
| **7** (Advanced) | 4 prompts (pick & choose) | ~10 hrs each | Graph viz, batch API, custom KBs, API access |

**Total Phases 4–7:** ~16–20 prompts depending on Phase 7 selections, ~85–115 hours.

**Critical go/no-go point:** After Phase 5 beta. If beta users aren't returning and providing positive feedback, do not build Phase 6. Fix the product first.
