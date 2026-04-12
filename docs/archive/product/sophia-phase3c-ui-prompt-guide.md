---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Phase 3c: UI Implementation — Copilot Prompt Guide

## Review of sophia-impl-plan.docx

The implementation plan is excellent — 20 prompts across 5 phases (A–E), each with precise CSS values, acceptance criteria, and clear component boundaries. It's the strongest spec in the project. Changes are needed before execution.

---

## Recommended Changes

### 1. Side Panel replaces Bottom Sheet (ARCHITECTURAL CHANGE)

The impl plan uses a bottom sheet — a mobile-native pattern (slide up from bottom, drag-to-dismiss). SOPHIA is shipping as a web app first. A **right-side slide-in panel** is the better pattern because:

- Users can read the three-pass output and browse claims *simultaneously* on desktop
- It's the standard web pattern for secondary content (VS Code sidebar, Notion comments, Figma inspector)
- It degrades cleanly to a full-width overlay on mobile

**What changes:**
- A2: `BottomSheet.svelte` → `SidePanel.svelte` (slide from right, not bottom; no drag-to-dismiss, close button instead)
- A3: Tab strip moves to top of side panel (horizontal, same design)
- D4: Page layout becomes flexbox row (main content + panel) on desktop, overlay on mobile
- E1: Reduced motion applies to slide-in transition instead of bottom sheet
- E2: ARIA changes from `role="dialog"` to `role="complementary"` (it's not modal on desktop)
- E3: Remove iOS drag-to-dismiss testing, add panel resize/overlay testing

**What stays the same:** Everything in Phases B and C (claims, badges, relations, sources, status bar, view toggle). These are panel *contents* — they don't care what container they're in.

### 2. SSE Event Format Mismatch (CRITICAL — must fix before Phase D)

The impl plan assumes SSE events shaped as:
```
{ type: 'chunk', pass: AnalysisPhase, text: string }
{ type: 'claims', pass: AnalysisPhase, claims: Claim[] }
{ type: 'relations', pass: AnalysisPhase, relations: [...] }
{ type: 'done', pass: AnalysisPhase }
```

The Phase 2 engine actually emits:
```
{ type: 'pass_start', pass: PassType }
{ type: 'pass_chunk', pass: PassType, content: string }
{ type: 'pass_complete', pass: PassType }
{ type: 'metadata', total_input_tokens, total_output_tokens, duration_ms }
{ type: 'error', message: string }
```

There are no `claims` or `relations` events yet — the engine doesn't extract claims during streaming.

**Action:** Add a new prompt (D0) that modifies the server engine to extract claims after each pass completes and emit `claims`/`relations` events. D1's sseHandler then handles both the existing Phase 2 events AND the new events.

### 3. `AnalysisPhase` vs `PassType` naming inconsistency

The impl plan defines `AnalysisPhase = 'analysis' | 'search' | 'critique' | 'synthesis'`. Phase 2 already has `PassType = 'analysis' | 'critique' | 'synthesis'`. The `'search'` phase doesn't exist yet (Phase 4).

**Action:** Use `PassType` from Phase 2. Remove `'search'` from `AnalysisPhase` in B1. Add it back in Phase 4. The SSE handler should gracefully ignore unknown pass types for forward compatibility.

### 4. Font size values appear very small

Several components specify `font-size: 0.38rem` (6px), `0.42rem` (6.7px), `0.44rem` (7px), `0.46rem` (7.4px), `0.48rem` (7.7px). At browser-default 16px root, these are below WCAG minimum readable size.

**Action:** Verify the design prototype's root font-size. If it uses a larger root, add that to base styles. If not, scale up to at least `0.625rem` (10px) minimum for metadata text.

### 5. Svelte 5 event syntax

Several prompts use `on:click` and `on:tab-change` (Svelte 4 syntax). Svelte 5 uses `onclick` and callback props.

**Action:** Noted per-prompt below. Copilot/Cursor will likely auto-correct.

### 6. Missing: Main content area preservation

D4's page wiring is light on the main content area. Phase 2's three-pass streaming output must be preserved — the side panel is additive.

**Action:** D4 prompt expanded to explicitly preserve existing main content.

### 7. Presence Mode toggle

The doc title mentions "Presence Mode" but no prompt implements it. The SettingsTab has a placeholder toggle.

**Action:** Leave as-is. Presence Mode is a future feature.

---

## AI Model Recommendations

| Phase | Prompts | Model | Why |
|-------|---------|-------|-----|
| A (Shell) | A1–A4 | Sonnet | Component creation, well-specified CSS |
| B (Claims) | B1–B5 | Sonnet | Types + components, highly specified |
| C (Sources) | C1–C4 | Sonnet | More components, same pattern |
| D (Integration) | D0–D4 | **Opus** | Engine modification, SSE routing, state coordination |
| E (Polish) | E1–E3 | Sonnet | CSS + ARIA, mechanical |

---

## Pre-Flight Check (Manual — Before Starting)

```bash
# Verify Phase 2 is working
cd ~/projects/sophia
pnpm dev
# Open http://localhost:5173 — submit a test question, confirm three-pass streaming works

# Verify Svelte 5 runes are in use
grep -r "\$state\|\$derived\|\$props\|\$effect" src/ | head -20

# Check current file structure
ls src/lib/components/
ls src/lib/stores/
ls src/lib/types/

# Create new directories
mkdir -p src/lib/components/shell
mkdir -p src/lib/components/panel
mkdir -p src/lib/components/references
mkdir -p src/lib/utils
```

---

## PHASE A — Shell & Navigation

### Prompt A1: Top Bar

Copy the A1 prompt from sophia-impl-plan.docx verbatim. No changes needed.

The top bar toggle button will open/close the side panel instead of a bottom sheet. The button, SVG icon, and menu-dot behaviour are all identical.

**Post-execution check:** Verify 44px height in DevTools. Verify menu-toggle event fires.

### Prompt A2: Side Panel (REPLACES Bottom Sheet)

**Do NOT use the A2 prompt from the impl plan.** Use this instead:

```
Create src/lib/components/shell/SidePanel.svelte.

The side panel slides in from the right edge and contains the tab navigation (History, References, Settings). It is NOT a modal on desktop — the user can read the main content alongside it.

DESKTOP (≥768px):
Position fixed, top 44px (below TopBar), right 0, bottom 0.
Width: 380px.
Background: var(--color-surface) (#141312).
Border-left: 1px solid var(--color-border) (#2E2C29).
Z-index: 50.
Default state: transform translateX(100%) — hidden off-screen right.
Open state (prop open=true): transform translateX(0).
Transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1).
Use will-change: transform.
overflow-y: auto, overflow-x: hidden.

No backdrop on desktop. Main content remains fully visible and interactive.

MOBILE (<768px):
Same panel but width: 100vw (full width overlay).
Add a backdrop: position fixed, inset 0, z-index 49.
Background rgba(0,0,0,0) when closed, rgba(0,0,0,0.5) when open.
Transition background 0.35s ease.
pointer-events none when closed, all when open.
Clicking backdrop calls onClose.

Close button (both viewports):
Inside the panel, top-right corner: a <button> with aria-label="Close panel".
44x44px touch target, background transparent, no border.
SVG: 16x16 viewBox, an × (two lines crossing), stroke var(--color-muted), stroke-width 1.3, stroke-linecap round.
On click: call onClose.

Props (Svelte 5 $props):
  open: boolean — controls open/closed state
  onClose: () => void — called when dismissed

Slot: default slot renders tab content (Phase A3 will fill this).

Use Svelte 5 runes throughout. Use $effect to handle body scroll lock on mobile when open (add overflow: hidden to document.body, remove on close/destroy).
```

**Acceptance criteria:**

| Check | Expected |
|-------|----------|
| Slide animation | Panel slides in from right in ~350ms on open. Smooth. |
| Desktop: no backdrop | Main content visible and clickable alongside open panel. |
| Mobile: backdrop | Backdrop fades in on mobile. Tap backdrop to close. |
| Close button | × button in top-right closes panel. |
| Scroll lock (mobile) | Body doesn't scroll behind open panel on mobile. |
| Slot renders | Default slot content appears inside panel. |
| Below top bar | Panel starts at 44px from top, doesn't overlap TopBar. |

### Prompt A3: Tab Strip & Tab Panels

Copy the A3 prompt from the impl plan with one context adjustment:

**Replace** the Context line with:
```
Context: SidePanel.svelte is built. Now adding the tab navigation inside it. The tab strip sits at the top of the side panel.
```

The tab strip design, tab-live-dot, and TabPanel routing are identical — they work the same whether inside a bottom sheet or a side panel.

**Svelte 5 note:** Replace `on:tab-change` with callback prop `onTabChange`.

**Post-execution check:** All three tabs switch. Indicator line animates. Live dot hidden initially.

### Prompt A4: Settings & History Tabs

Copy the A4 prompt verbatim. No changes needed — these are panel contents, not container-dependent.

**Note:** The Presence Mode toggle is a placeholder — it doesn't need to control anything yet.

**Post-execution check:** Settings toggles animate. History empty state shows italic text. Demo history items render with arc SVGs.

---

## PHASE B — References Panel (Claims View)

### Prompt B1: Types & Store

Copy the B1 prompt with this modification:

**Change** the `AnalysisPhase` type to:
```typescript
export type AnalysisPhase = 'analysis' | 'critique' | 'synthesis';
// 'search' phase added in Phase 4 (web search gap-fill)
```

This aligns with Phase 2's existing `PassType`. Keep the rest of B1 exactly as written.

**Post-execution check:** All types export without TS errors. Store mutations work (test in console).

### Prompt B2: Badge Component

Copy B2 verbatim.

**Font size note:** If `0.38rem` renders unreadably small (below ~9px), increase to `0.5rem`.

**Post-execution check:** All 7 badge variants render with correct colours.

### Prompt B3: Relation Tags & Row

Copy B3 verbatim.

**Post-execution check:** Tags fade in with 0.6s transition. 300ms stagger. No re-animation of existing tags.

### Prompt B4: Claim Card

Copy B4 verbatim.

**Post-execution check:** Entrance animation works. Detail panel expands/collapses. Source line in monospace.

### Prompt B5: Claims View (Container)

Copy B5 verbatim.

**Post-execution check:** Claims stagger in with rAF timing. Empty state shows italic text. Smooth scrolling.

---

## PHASE C — Sources View + Live Status

### Prompt C1: Sources View

Copy C1 verbatim.

**Post-execution check:** Claims grouped by source. Expandable groups. Claim count badge per group.

### Prompt C2: View Toggle

Copy C2 verbatim.

**Post-execution check:** Toggle is sticky on scroll. Active tab has bottom border. No content bleed-through.

### Prompt C3: Status Bar

Copy C3 verbatim.

**Post-execution check:** Dot pulses during live phases. "Analysis complete" shows static dot. Auto-hides after 2.2s.

### Prompt C4: References Tab Assembly

Copy C4 verbatim.

**Post-execution check:** Full panel renders: StatusBar + ViewToggle + Claims/Sources. Tab live dot and menu dot wire correctly.

---

## PHASE D — SSE Integration (USE OPUS FOR ALL OF PHASE D)

### Prompt D0: Engine Claim Extraction (NEW — not in original impl plan)

```
Modify src/routes/api/analyse/+server.ts and src/lib/server/engine.ts to emit 'claims' and 'relations' SSE events after each pass completes.

CONTEXT: The existing engine streams pass_start, pass_chunk, pass_complete, and metadata events. The new References panel needs 'claims' and 'relations' events to populate the panel with structured philosophical claims extracted from each pass's output.

APPROACH: After each pass completes (after onPassComplete fires), make one additional Claude API call to extract claims from that pass's output text. This is a lightweight extraction — not the full ingestion pipeline, just identifying the key claims referenced in the analysis.

1. Create src/lib/server/prompts/live-extraction.ts:

Export LIVE_EXTRACTION_SYSTEM prompt:
"You are extracting the key philosophical claims referenced in this analysis text. For each distinct claim, provide:
- id: a short unique identifier (e.g., 'c1', 'c2')
- text: the claim in 1-2 sentences
- badge: one of 'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical'
- source: 'Author, Work · Year' if referenced, or 'Analysis' if original to this pass
- tradition: the philosophical tradition (e.g., 'Virtue Ethics', 'Kantian Deontology')
- detail: 2-3 sentence contextual note explaining the claim's role in the argument
- phase: '{CURRENT_PHASE}'

Also identify relations between claims:
- claimId: the 'from' claim id
- relations: array of { type: 'supports' | 'contradicts' | 'responds-to' | 'depends-on', target: target claim id, label: short human label }

Extract 3-8 claims per pass. Prefer quality over quantity. Focus on the philosophically substantive claims, not every assertion.

Respond ONLY with valid JSON: { claims: [...], relations: [...] }"

Export function buildLiveExtractionPrompt(passText: string, phase: string): string

2. In engine.ts, add a new callback:
   onClaims(claims: Claim[], relations: RelationBundle[]): void

3. After each pass completes (after onPassComplete), call Claude with the live extraction prompt using the pass output text. Temperature 0.2, max_tokens 1500. Parse the JSON response.

4. Call onClaims with the parsed claims and relations.

5. In +server.ts, when onClaims fires, emit two SSE events:
   data: { type: 'claims', pass: currentPass, claims: [...] }
   data: { type: 'relations', pass: currentPass, relations: [...] }

6. This extraction is NON-BLOCKING for the next pass. If extraction fails (bad JSON, API error), log the error and skip — do not block the three-pass pipeline. The references panel degrades gracefully to empty.

7. Cost note: This adds 3 extra Claude calls per analysis (~£0.01 total). Log the additional token usage.
```

**Acceptance criteria:**
- Three-pass streaming still works exactly as before
- After each pass completes, `claims` and `relations` events appear in the SSE stream
- If extraction fails, the three-pass output is unaffected
- Token usage logging includes extraction calls

### Prompt D1: SSE Event Handler

Copy D1 from the impl plan with this addition at the beginning:

```
IMPORTANT: The SSE stream emits two categories of events:

Phase 2 events (already handled by existing code):
  { type: 'pass_start', pass: PassType }
  { type: 'pass_chunk', pass: PassType, content: string }
  { type: 'pass_complete', pass: PassType }
  { type: 'metadata', ... }

New Phase 3c events (handled by sseHandler.ts):
  { type: 'claims', pass: AnalysisPhase, claims: Claim[] }
  { type: 'relations', pass: AnalysisPhase, relations: [...] }

The sseHandler should process ONLY 'claims', 'relations', and 'done' events for the references panel. 'pass_chunk' events continue to be handled by the existing conversation store for the main content area. Do not duplicate that handling.
```

Rest of D1 as written in the impl plan.

### Prompt D2: Back-Reference Resolution

Copy D2 verbatim. No changes needed.

### Prompt D3: History Integration

Copy D3 verbatim. No changes needed.

### Prompt D4: Main Page Wiring (MODIFIED for Side Panel layout)

**Do NOT use the D4 prompt from the impl plan verbatim.** Use this instead:

```
In src/routes/+page.svelte, integrate the full shell with the side panel.

IMPORTANT: The main content area — where the three-pass analysis text streams and displays — already works from Phase 2. DO NOT replace or restructure it. The side panel is ADDITIVE. It sits alongside the existing experience.

Imports needed:
TopBar, SidePanel, TabStrip, TabPanel
HistoryTab, ReferencesTab, SettingsTab
referencesStore, historyStore
handleSSEEvent, resetForNewExploration

App-level state:
  panelOpen: boolean = false
  activeTab: string = 'history'

LAYOUT STRUCTURE:

<div class="app-shell">
  <TopBar
    menuDotVisible={referencesStore.isLive}
    onMenuToggle={() => panelOpen = !panelOpen}
  />

  <div class="app-body">
    <main class="main-content" class:panel-open={panelOpen}>
      <!-- Existing Phase 2 content: input form, three-pass streaming output -->
      <!-- Everything currently in +page.svelte stays here, unchanged -->
    </main>

    <SidePanel open={panelOpen} onClose={() => panelOpen = false}>
      <TabStrip
        {activeTab}
        refsLive={referencesStore.isLive}
        onTabChange={(tab) => activeTab = tab}
      />
      <TabPanel name="history" {activeTab}>
        <HistoryTab items={historyStore.items} />
      </TabPanel>
      <TabPanel name="references" {activeTab}>
        <ReferencesTab />
      </TabPanel>
      <TabPanel name="settings" {activeTab}>
        <SettingsTab />
      </TabPanel>
    </SidePanel>
  </div>
</div>

CSS for .app-body:
  display: flex
  min-height: calc(100vh - 44px)
  position: relative

CSS for .main-content:
  flex: 1
  min-width: 0  /* prevent flex overflow */
  transition: margin-right 0.35s cubic-bezier(0.32, 0.72, 0, 1)
  /* Existing padding and max-width from Phase 2 */

CSS for .main-content.panel-open (desktop ≥768px only):
  margin-right: 380px
  /* Content reflows to accommodate the panel — not overlapped, not hidden */

@media (max-width: 767px):
  .main-content.panel-open: margin-right: 0
  /* On mobile the panel overlays, main content doesn't reflow */

When starting a new analysis (user submits question):
1. Call resetForNewExploration()
2. Begin SSE stream
3. For each parsed event, call handleSSEEvent(event)

When SSE stream ends (synthesis done):
4. Call addToHistory(question, questionCount, '#6FA3D4')

The existing three-pass output (Analysis / Critique / Synthesis text streaming)
continues to work as before — handleSSEEvent routes chunk events to it.
Only the claims/relations events are new.
```

**Acceptance criteria:**

| Check | Expected |
|-------|----------|
| Menu toggle | Tapping top-bar icon opens/closes side panel. |
| Desktop layout | Panel open: main content reflows with 380px right margin. Both visible simultaneously. |
| Mobile layout | Panel open: full-width overlay with backdrop. Main content doesn't shift. |
| Content preserved | Three-pass streaming still works exactly as Phase 2. |
| Panel content | References tab shows claims populating during analysis. |
| History update | Completing analysis adds entry to History tab. |
| Smooth transition | Main content margin animates when panel opens/closes (desktop). |

---

## PHASE E — Polish & Verification

### Prompt E1: Reduced Motion

Copy E1 from the impl plan with these substitutions:

- Replace all references to `#bottom-sheet` with `.side-panel`
- Replace all references to `#sheet-backdrop` with `.panel-backdrop`
- Replace references to "sheet slide" with "panel slide"
- The `.side-panel` transition override: `transition: none !important;`
- The `.main-content` margin-right transition override: `transition: none !important;`

Everything else in E1 (claim animations, status bar, relation tags, settings toggle) stays identical.

**Post-execution check:** Enable "Reduce motion" in system preferences. Verify panel appears instantly (no slide). Claims appear instantly. Main content margin snaps (no animation).

### Prompt E2: Accessibility

Copy E2 from the impl plan with these modifications:

**TopBar:** Same as written (aria-expanded, aria-controls).

**SidePanel (replaces BottomSheet section):**
```
SidePanel root div:
  Desktop (≥768px): role="complementary", aria-label="References and navigation"
    — NOT role="dialog" because it's not modal on desktop. The main content remains interactive.
  Mobile (<768px): role="dialog", aria-label="Navigation", aria-modal="true"
    — IS modal on mobile because backdrop blocks main content.

Use a $effect watching both `open` prop and viewport width to toggle the role attribute.

When panel opens on mobile: set focus to the close button.
When panel closes: return focus to menu-btn.
On desktop: do NOT steal focus when panel opens — user may be reading main content.
```

**TabStrip, ClaimCard, ClaimsView:** Same as written in E2.

**Keyboard:** Add `Escape` key to close the panel (both viewports).

**Post-execution check:** Tab through entire UI with keyboard. Verify focus management differs between mobile and desktop. Run Lighthouse accessibility audit.

### Prompt E3: Cross-Browser & Performance

Copy E3 from the impl plan with these substitutions:

**Remove:**
- iOS drag-to-dismiss testing (no longer applicable)
- Android overscroll-behavior on sheet content (no longer applicable)

**Add:**
```
SIDE PANEL SPECIFIC CHECKS:

Desktop Chrome/Firefox/Safari:
  - Panel slides in from right smoothly (no jank)
  - Main content margin-right transition is smooth
  - Panel scrolls independently from main content
  - Opening panel does not cause layout thrashing (check Performance panel)
  - Panel width is exactly 380px

Mobile Safari:
  - Panel opens as full-width overlay
  - Backdrop tap closes panel
  - Body scroll is locked when panel is open
  - No rubber-banding on panel content scroll

Mobile Chrome:
  - Same as Safari checks
  - Add overscroll-behavior: contain to .side-panel
```

**Post-execution check:** Test panel on iOS Safari, Chrome Android, desktop Firefox. Check DevTools Performance panel for layout thrashing during panel open/close and claim animations.

---

## PHASE F — Production Deploy

### Prompt F1: Font Loading & Design Tokens Audit

```
Before deploying the UI changes to production, audit the design token implementation.

1. Verify font loading in src/app.html or +layout.svelte:
   - Cormorant Garamond (Google Fonts): weights 300, 400, 600
   - JetBrains Mono (Google Fonts): weight 400
   - Add <link rel="preconnect" href="https://fonts.googleapis.com">
   - Add <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   - Add the Google Fonts <link> for both families
   - Alternatively, self-host the fonts in static/fonts/ for performance

2. Verify src/styles/design-tokens.css exists and contains ALL tokens:
   --color-bg: #1A1917
   --color-surface: #141312
   --color-raised: #201F1D
   --color-text: #E8E6E1
   --color-muted: #9E9A93
   --color-dim: #4A4845
   --color-border: #2E2C29
   --color-sage: #7FA383
   --color-copper: #D4936F
   --color-blue: #6FA3D4
   --color-amber: #C4A882

3. Check that design-tokens.css is imported in the app's CSS entry point.

4. Run Lighthouse on localhost:
   - Performance score (check font loading impact)
   - Accessibility score (target >90)
   - Best practices score

5. Fix any issues found.
```

### Prompt F2: Build & Smoke Test

```
Run a production build and verify everything works.

1. Build:
   pnpm build

   Fix any build errors. Common issues:
   - Type errors in new components
   - Missing imports
   - Svelte 5 runes not compiling (check svelte.config.js)

2. Preview locally:
   pnpm preview

   Test the full flow:
   - Load the app — verify dark background, fonts loaded, top bar visible
   - Submit a question — verify three-pass streaming works
   - Click the menu icon — verify side panel slides in from right
   - Desktop: verify main content reflows (margin-right: 380px), both visible
   - Wait for analysis to complete — verify claims appear in references panel
   - Click a claim — verify detail panel expands
   - Switch to Sources view — verify grouping
   - Check History tab — verify entry was added
   - Check Settings tab — verify toggles work
   - Close panel — verify main content reflows back
   - Test on mobile viewport (Chrome DevTools, 375px width):
     - Panel should be full-width overlay with backdrop
     - Tap backdrop to close
     - Body scroll locked when panel open
   - Test on tablet viewport (768px width):
     - Panel should be 380px with content reflow

3. If any test fails, fix before proceeding.
```

### Manual: Push to Production

```bash
# Stage all changes
git add -A

# Review what's changed
git diff --cached --stat

# Commit
git commit -m "feat: Phase 3c UI — references panel, side panel, design system B

- TopBar with SOPHIA branding and menu toggle
- Side panel (replaces bottom sheet): slides from right, 380px desktop, full-width mobile
- Desktop: main content reflows alongside panel (concurrent reading)
- Mobile: full-width overlay with backdrop
- References panel: claims view with badges, relation tags, entrance animations
- Sources view with grouped claims
- Live status bar with phase-specific messages
- SSE integration: claim extraction after each pass
- History tab with exploration log
- Settings tab with reduce motion toggle
- Full accessibility pass: ARIA (complementary on desktop, dialog on mobile), keyboard nav
- Design System B: Cormorant Garamond + JetBrains Mono, dark-first
- Cross-browser: iOS Safari, Chrome Android, Firefox"

# Push — triggers GitHub Actions deploy
git push origin main

# Monitor deployment
echo "Watch: https://github.com/Allotment-Technology-Ltd/sophia/actions"
```

### Manual: Post-Deploy Verification

```bash
# Wait for deployment to complete (~3-5 minutes)

# Health check
curl -s https://sophia-210020077715.europe-west1.run.app/api/health | jq .

# Open in browser
open https://sophia-210020077715.europe-west1.run.app

# Test checklist:
# [ ] Dark background loads, fonts render correctly
# [ ] Submit "Is moral relativism defensible?"
# [ ] Three passes stream in main content area
# [ ] Click menu icon → side panel slides in from right
# [ ] Desktop: main content reflows, both readable simultaneously
# [ ] References tab shows claims appearing during analysis
# [ ] Claims have badges, relation tags animate in
# [ ] Switch to Sources view — claims grouped by source
# [ ] Close panel — content reflows back to full width
# [ ] History tab shows the completed exploration
# [ ] Test on actual mobile device:
#     - Panel opens full-width with backdrop
#     - Tap backdrop to close
# [ ] Check custom domain if DNS has propagated:
#     open https://usesophia.app
```

---

## Prompt Execution Summary

| # | Prompt | Source | Model | Time Est. |
|---|--------|--------|-------|-----------|
| Pre-flight | Verify Phase 2, create directories | Manual | — | 5 min |
| A1 | TopBar | impl-plan verbatim | Sonnet | 3 min |
| **A2** | **SidePanel (NEW prompt)** | **This guide** | **Sonnet** | **5 min** |
| A3 | TabStrip & Panels | impl-plan + context tweak | Sonnet | 4 min |
| A4 | Settings & History tabs | impl-plan verbatim | Sonnet | 5 min |
| B1 | Types & Store | impl-plan + AnalysisPhase fix | Sonnet | 4 min |
| B2 | ClaimBadge | impl-plan verbatim | Sonnet | 3 min |
| B3 | RelationTag & Row | impl-plan verbatim | Sonnet | 4 min |
| B4 | ClaimCard | impl-plan verbatim | Sonnet | 5 min |
| B5 | ClaimsView | impl-plan verbatim | Sonnet | 4 min |
| C1 | SourcesView | impl-plan verbatim | Sonnet | 4 min |
| C2 | ViewToggle | impl-plan verbatim | Sonnet | 3 min |
| C3 | StatusBar | impl-plan verbatim | Sonnet | 3 min |
| C4 | ReferencesTab assembly | impl-plan verbatim | Sonnet | 3 min |
| **D0** | **Engine claim extraction (NEW)** | **This guide** | **Opus** | **8 min** |
| D1 | SSE handler | impl-plan + event format fix | **Opus** | 5 min |
| D2 | Back-references | impl-plan verbatim | **Opus** | 4 min |
| D3 | History integration | impl-plan verbatim | **Opus** | 3 min |
| **D4** | **Main page wiring (NEW prompt)** | **This guide** | **Opus** | **5 min** |
| **E1** | Reduced motion | impl-plan + panel substitutions | Sonnet | 3 min |
| **E2** | Accessibility | impl-plan + panel ARIA changes | Sonnet | 4 min |
| **E3** | Cross-browser | impl-plan + panel-specific checks | Sonnet | 3 min |
| F1 | Font & token audit | This guide | Sonnet | 3 min |
| F2 | Build & smoke test | This guide | Sonnet | 5 min |
| Deploy | git push + verify | Manual | — | 10 min |
| **Total** | **24 prompts + manual steps** | | | **~115 min** |

Prompts in **bold** have been modified or are new compared to the impl plan. All others can be copied verbatim from sophia-impl-plan.docx.

---

## Troubleshooting

**If claim extraction (D0) returns empty or fails:**
```
The live claim extraction in engine.ts is failing to parse JSON from Claude's response. The extraction prompt may be returning markdown-wrapped JSON. Fix the parsing: strip any text before the first '{' and after the last '}', handle ```json fences. If extraction consistently fails, add a fallback that emits empty claims/relations events so the references panel shows its empty state gracefully.
```

**If side panel overlaps main content on mobile:**
```
The side panel should be full-width on mobile (<768px) with a backdrop overlay. The main content should NOT have margin-right applied on mobile. Check: (1) the @media query breakpoint is correct, (2) .main-content.panel-open only applies margin-right inside @media (min-width: 768px), (3) the panel has width: 100vw on mobile.
```

**If main content doesn't reflow on desktop:**
```
The main content should gain margin-right: 380px when the panel opens on desktop. Check: (1) the .panel-open class is being toggled on .main-content, (2) the CSS rule is inside @media (min-width: 768px), (3) the transition property matches the panel's slide transition timing. If the content jumps instead of animating, verify the cubic-bezier matches between .main-content and .side-panel transitions.
```

**If fonts don't load on production:**
```
Google Fonts may be blocked by CSP or not loading in the Cloud Run environment. Check: (1) the <link> tags are in app.html not just +layout.svelte, (2) no Content-Security-Policy header is blocking fonts.googleapis.com, (3) try self-hosting: download the font files, place in static/fonts/, and use @font-face declarations instead of Google Fonts CDN.
```

**If claims don't appear in the references panel:**
```
The references panel shows empty state even after analysis completes. Debug: (1) Check browser DevTools Network tab for SSE events — do you see 'claims' events? (2) If no claims events, check server logs for extraction errors. (3) If claims events exist but panel is empty, check that sseHandler.ts is being called and referencesStore.addClaims is updating. (4) Verify the component is reading from referencesStore.activeClaims reactively.
```

**If Escape key doesn't close panel:**
```
The Escape key handler should be a document-level keydown listener added in SidePanel.svelte when open=true. Check: (1) the listener is added in a $effect that watches the open prop, (2) it's removed on component destroy or when open becomes false, (3) it calls onClose(). Add: if (e.key === 'Escape' && open) onClose().
```
