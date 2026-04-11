---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Phase 3c — Master Design Implementation Guide

## Context

This guide synthesises four source documents into a single authoritative reference for implementing SOPHIA's Phase 3c UI redesign:

1. **`docs/design/sophia-design-system-B.md`** — Visual spec: colours, typography, spacing, component styles, animations (locked, Design B)
2. **`docs/design/sophia-phase3c-ui-prompt-guide.md`** — Architecture decisions, corrections to impl plan, per-prompt instructions
3. **`docs/design/sophia-prompts-addendum.md`** — AI engine prompts (P1–P5), live extraction format
4. **`docs/design/sophia-impl-plan.docx`** — Original 20-prompt implementation plan (many prompts usable verbatim; key corrections documented here)

The Phase 4–7 guide (`sophia-phases-4-7-prompt-guide.md`) covers future work and is referenced at the end.

---

## Critical Architecture Decision: Side Panel (not Bottom Sheet)

The original impl plan specifies a **bottom sheet** for A2. This is the wrong pattern for a web-first app.

**Use a right-side slide-in panel (`SidePanel.svelte`) instead.** Reasons:
- Users read three-pass output and browse references *simultaneously* on desktop
- Standard web pattern (VS Code, Notion, Figma inspector)
- Degrades cleanly to full-width overlay on mobile (no drag-to-dismiss needed)

**Cascading changes from this decision:**
| Prompt | Original | Corrected |
|--------|----------|-----------|
| A2 | `BottomSheet.svelte` (slide up, drag-to-dismiss) | `SidePanel.svelte` (slide from right, close button) |
| D4 | Side-panel layout in +layout.svelte | Flexbox row layout in **+page.svelte** |
| E1 | Sheet slide suppression | Panel slide suppression |
| E2 | `role="dialog"` always | `role="complementary"` on desktop, `role="dialog"` on mobile |
| E3 | iOS drag-to-dismiss testing | Panel resize/overlay testing |

---

## Current State (What Is Already Built)

| File | Status | Notes |
|------|--------|-------|
| `src/styles/design-tokens.css` | ✅ Done | Design B tokens, all CSS custom properties |
| `src/styles/animations.css` | ✅ Done | All keyframes + prefers-reduced-motion |
| `src/app.css` | ✅ Done | Imports tokens + animations, sets body/focus defaults |
| `src/lib/components/shell/TopBar.svelte` | ✅ Done | Verify `--nav-height` is **44px** not 48px (A2 spec: `top: 44px`) |
| `src/lib/components/sheet/BottomSheet.svelte` | ❌ Wrong pattern | Replace with `panel/SidePanel.svelte` |
| `src/lib/components/sheet/TabStrip.svelte` | ✅ Logic correct | Move to `panel/` directory, minor prop rename |
| `src/lib/components/sheet/SheetPanel.svelte` | ⚠️ Partial | Rename to `panel/PanelContainer.svelte` or inline into SidePanel |
| `src/lib/components/sheet/SettingsTab.svelte` | ✅ Done | Move to `panel/` |
| `src/lib/components/sheet/HistoryTab.svelte` | ✅ Done | Move to `panel/` |
| `src/routes/+layout.svelte` | ⚠️ Over-wired | TopBar belongs here; BottomSheet/Panel wiring moves to +page.svelte per D4 |

**Directory correction:** rename `src/lib/components/sheet/` → `src/lib/components/panel/`

---

## Design Tokens Quick Reference

```css
/* Navigation */
--nav-height: 44px;          /* TopBar height — A1 spec says 44px (not 48px) */

/* Backgrounds */
--color-bg: #1A1917           /* Main canvas */
--color-surface: #141312      /* Cards, nav, panel */
--color-surface-raised: #201F1D

/* Text */
--color-text: #E8E6E1
--color-muted: #9E9A93
--color-dim: #4A4845
--color-border: #2E2C29

/* Accents */
--color-sage: #7FA383         /* Analysis / primary */
--color-copper: #D4936F       /* Critique / follow-up */
--color-blue: #6FA3D4         /* Synthesis / links */
--color-amber: #C4A882        /* Used in Phase 4+ */

/* Fonts */
--font-display: 'Cormorant Garamond', Georgia, serif   /* All prose */
--font-ui: 'JetBrains Mono', 'Courier New', monospace  /* All chrome */
```

---

## Implementation Sequence

### ─── PHASE A: Shell & Navigation ───

**A1 — TopBar** `src/lib/components/shell/TopBar.svelte` ✅
- Fix: ensure `--nav-height` token is `44px`
- Post-check: 44px height in DevTools. `onMenuToggle` fires.

**A2 — SidePanel (REPLACES BottomSheet)** `src/lib/components/panel/SidePanel.svelte`

Full replacement prompt (do NOT use impl-plan A2):
```
Create src/lib/components/panel/SidePanel.svelte.

DESKTOP (≥768px):
- position: fixed, top: 44px, right: 0, bottom: 0
- width: 380px
- background: var(--color-surface)
- border-left: 1px solid var(--color-border)
- z-index: 50
- Hidden: transform: translateX(100%). Open (prop open=true): translateX(0)
- Transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)
- will-change: transform; overflow-y: auto; overflow-x: hidden
- NO backdrop on desktop. Main content stays visible and interactive.

MOBILE (<768px):
- width: 100vw (full overlay)
- Backdrop: position fixed, inset 0, z-index 49
- rgba(0,0,0,0) closed → rgba(0,0,0,0.5) open, transition 0.35s ease
- pointer-events: none when closed, all when open
- Clicking backdrop calls onClose.

Close button (both viewports):
- 44×44px, top-right of panel, background transparent, no border
- SVG 16×16 "×" (two lines), stroke var(--color-muted), stroke-width 1.3, round caps
- onclick: calls onClose

Props ($props): open: boolean, onClose: () => void
Children: default snippet renders tab content

$effect: body scroll lock on mobile when open (add overflow: hidden to document.body, remove on close/destroy)
Use Svelte 5 runes throughout.
```

Acceptance criteria:
| Check | Expected |
|-------|----------|
| Slide animation | From right, ~350ms |
| Desktop: no backdrop | Main content clickable alongside panel |
| Mobile: backdrop | Fades in, tap to close |
| Close button | × closes panel |
| Scroll lock (mobile) | Body frozen behind panel |
| Top: 44px | Does not overlap TopBar |

**A3 — TabStrip** `src/lib/components/panel/TabStrip.svelte`
- Copy existing `sheet/TabStrip.svelte` to `panel/TabStrip.svelte`
- Context line: "SidePanel.svelte is built. Tab strip sits at top of side panel."
- Three tabs: `references | history | settings`
- `onTabChange` callback prop (not `on:tab-change`)
- Live dot on References tab: hidden by default, visible when `showLiveDot=true`
- Post-check: All three tabs switch. Indicator line animates. Live dot hidden initially.

**A4 — Settings & History Tabs** — reuse `sheet/SettingsTab.svelte` + `sheet/HistoryTab.svelte`
- Presence Mode toggle: placeholder (no behaviour yet)
- Reduce Motion toggle: reads `prefers-reduced-motion`, writes `html.reduce-motion` class
- History empty state: italic Cormorant "Ready to think? Describe a decision that matters."
- Post-check: Toggles animate. History empty state shows. Demo items render with arc SVGs.

**A — Layout wiring** (defer full wiring to D4)
- `+layout.svelte`: keep TopBar only; remove BottomSheet/SidePanel/panel state
- `+page.svelte`: owns `panelOpen` state and SidePanel (per D4 prompt below)

---

### ─── PHASE B: References Panel (Claims View) ───

**B1 — Types & Store** `src/lib/types/references.ts` + `src/lib/stores/references.svelte.ts`

```typescript
// Types
export type AnalysisPhase = 'analysis' | 'critique' | 'synthesis';
// 'search' phase added in Phase 4

export type BadgeVariant = 'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical';

export interface Claim {
  id: string;
  text: string;
  badge: BadgeVariant;
  source: string;           // 'Author, Work · Year' or 'Analysis'
  tradition: string;
  detail: string;           // 2-3 sentence contextual note
  phase: AnalysisPhase;
  backRefIds?: string[];    // IDs of claims this references back to
}

export interface RelationBundle {
  claimId: string;
  relations: Array<{
    type: 'supports' | 'contradicts' | 'responds-to' | 'depends-on';
    target: string;         // target claim id
    label: string;
  }>;
}

// Store (Svelte 5 runes)
// State: activeClaims[], relations[], isLive bool, currentPhase, claimsPerPhase record
// Mutations: addClaims(phase, claims, relations), reset(), setLive(bool), setPhase(phase)
// Computed: activeClaims sorted by phase order, claimCount
```

Post-check: Types export without TS errors. Store mutations work.

**B2 — ClaimBadge** `src/lib/components/references/ClaimBadge.svelte`

Seven variants (see design system badges section):
| Variant | Background | Color | Border |
|---------|------------|-------|--------|
| thesis | `--color-sage-bg` | `--color-sage` | `--color-sage-border` |
| premise | `--color-blue-bg` | `--color-blue` | `--color-blue-border` |
| objection | `--color-copper-bg` | `--color-copper` | `--color-copper-border` |
| response | `--color-sage-bg` | `--color-sage` | `--color-sage-border` |
| definition | transparent | `--color-dim` | `--color-border` |
| empirical | `--color-blue-bg` | `--color-blue` | `--color-blue-border` |

Font: JetBrains Mono 400, `0.62rem` min (10px minimum — do not go below), uppercase, letter-spacing 0.10em.
Padding: 4px 10px. Border-radius: 2px.

Post-check: All 7 variants render with correct colours.

**B3 — RelationTag & ClaimRow** `src/lib/components/references/RelationTag.svelte` + `ClaimRow.svelte`

RelationTag:
- Four types: `supports` (sage), `contradicts` (copper), `responds-to` (blue), `depends-on` (dim)
- Fade-in animation: 0.6s transition. 300ms stagger between tags.
- No re-animation of existing tags.

ClaimRow: claim text + badge + relation tags. Used inside ClaimCard and SourcesView.

**B4 — ClaimCard** `src/lib/components/references/ClaimCard.svelte`

```
Card: background --color-surface, border 1px solid --color-border, border-radius 3px
Entrance animation: fadeIn 400ms ease (from opacity:0 translateY(8px))
Header: badge + source line (JetBrains Mono 0.6rem, --color-dim)
Body: claim text (Cormorant 300, 1rem, 1.85 line-height)
Expandable detail: clicking card toggles a detail panel below body
  Detail: Cormorant italic 0.9rem --color-muted, 2-3 sentences
  Expand/collapse: height transition 200ms ease
Source line (in detail): JetBrains Mono 0.6rem --color-dim
Relation tags: shown at bottom, stagger in 300ms after card appears
```

Post-check: Entrance animation works. Detail panel expands/collapses. Source in monospace.

**B5 — ClaimsView** `src/lib/components/references/ClaimsView.svelte`

- Reads from referencesStore
- Claims stagger in using requestAnimationFrame timing (16ms between each)
- Empty state: italic Cormorant "No claims yet. Analysis will populate this panel."
- Smooth scroll when new claims arrive
- Phase section headers (Analysis / Critique / Synthesis) in eyebrow style

Post-check: Claims stagger in. Empty state shows italic text. Smooth scrolling.

---

### ─── PHASE C: Sources View + Live Status ───

**C1 — SourcesView** `src/lib/components/references/SourcesView.svelte`

- Claims grouped by `source` field
- Each group: expandable header showing source name + claim count badge
- Claims within group: ClaimRow components
- Post-check: Claims grouped by source. Expandable groups. Claim count badge per group.

**C2 — ViewToggle** `src/lib/components/references/ViewToggle.svelte`

- Two tabs: "Claims" | "Sources"
- Sticky at top of references panel (position: sticky, top: 0)
- Active tab: 2px bottom border in `--color-sage`
- Post-check: Toggle is sticky on scroll. Active tab has bottom border. No bleed-through.

**C3 — StatusBar** `src/lib/components/references/StatusBar.svelte`

- Shows live phase status with pulsing dot during active phases
- Messages: "Mapping the landscape..." / "Finding weaknesses..." / "Integrating tensions..."
- "Analysis complete" on finish — static dot
- Auto-hides 2.2s after completion
- Font: JetBrains Mono 0.6rem, --color-sage

Post-check: Dot pulses during live phases. Auto-hides after 2.2s.

**C4 — ReferencesTab Assembly** `src/lib/components/references/ReferencesTab.svelte`

Composes: StatusBar (top) + ViewToggle (sticky) + ClaimsView | SourcesView (conditional on toggle)

Post-check: Full panel: StatusBar + ViewToggle + Claims/Sources. Tab live dot wires correctly.

---

### ─── PHASE D: SSE Integration (USE OPUS) ───

**D0 — Engine Claim Extraction (NEW — not in impl plan)**
Files: `src/lib/server/prompts/live-extraction.ts` + modifications to `src/lib/server/engine.ts` + `src/routes/api/analyse/+server.ts`

After each pass completes, make one additional Claude API call to extract structured claims:
- Temperature: 0.2, max_tokens: 1500
- Extract 3-8 claims per pass (quality over quantity)
- Output: `{ claims: Claim[], relations: RelationBundle[] }`
- Non-blocking: if extraction fails, log and skip; do NOT block the three-pass pipeline
- Emit two SSE events after extraction:
  ```
  { type: 'claims', pass: currentPass, claims: [...] }
  { type: 'relations', pass: currentPass, relations: [...] }
  ```
- Cost: ~3 extra Claude calls per analysis (~£0.01 total)

See `sophia-phase3c-ui-prompt-guide.md` § D0 for the full extraction system prompt.

Post-check: Three-pass streaming unaffected. `claims` + `relations` events appear in SSE stream after each pass.

**D1 — SSE Event Handler** `src/lib/utils/sseHandler.ts`

Handles BOTH event categories:
```
Phase 2 events (existing, still handled by conversation store):
  pass_start | pass_chunk | pass_complete | metadata | error

Phase 3c events (new, routed to referencesStore):
  claims → referencesStore.addClaims(phase, claims, relations)
  relations → (bundled with claims above)
```

CRITICAL: Do not duplicate `pass_chunk` handling. The conversation store still owns the main three-pass text output.

**D2 — Back-Reference Resolution** `src/lib/utils/backRef.ts`

When a claim from Pass 2/3 references a claim from Pass 1 by ID, populate `backRefIds` on the later claim. This enables the "responds to" and "depends on" relation rendering.

**D3 — History Integration** `src/lib/stores/history.svelte.ts`

- On analysis complete (`metadata` SSE event): add to history with question text, timestamp, passCount=3
- Persist to localStorage
- Wire to HistoryTab component (existing)
- On history item click: load that conversation's context (Phase 4 handles full persistence)

**D4 — Main Page Wiring** (MODIFIED — replaces impl-plan D4)
File: `src/routes/+page.svelte`

Layout structure:
```svelte
<div class="app-shell">
  <!-- TopBar is in +layout.svelte, not here -->

  <div class="app-body">
    <main class="main-content" class:panel-open={panelOpen}>
      <!-- Existing Phase 2 content stays HERE, unchanged -->
      <!-- Input form + three-pass streaming output + metadata -->
    </main>

    <SidePanel open={panelOpen} onClose={() => panelOpen = false}>
      <TabStrip {activeTab} refsLive={referencesStore.isLive}
                onTabChange={(tab) => activeTab = tab} />
      <TabPanel name="references" {activeTab}><ReferencesTab /></TabPanel>
      <TabPanel name="history" {activeTab}><HistoryTab items={historyStore.items} /></TabPanel>
      <TabPanel name="settings" {activeTab}><SettingsTab /></TabPanel>
    </SidePanel>
  </div>
</div>
```

CSS:
```css
.app-body { display: flex; min-height: calc(100vh - 44px); position: relative; }
.main-content { flex: 1; min-width: 0; transition: margin-right 0.35s cubic-bezier(0.32, 0.72, 0, 1); }

@media (min-width: 768px) {
  .main-content.panel-open { margin-right: 380px; }
}
/* Mobile: panel overlays, no margin-right shift */
```

TopBar wiring: `onMenuToggle={() => panelOpen = !panelOpen}`, `menuDotVisible={referencesStore.isLive}`

SSE stream wiring: for each parsed event → `handleSSEEvent(event)`. On completion → `addToHistory(...)`.

---

### ─── PHASE E: Polish & Verification ───

**E1 — Reduced Motion**
- Target selectors: `.side-panel` (not `#bottom-sheet`), `.panel-backdrop`, `.main-content`
- Override: `transition: none !important` on each
- Claims, status bar, relation tags: `animation-duration: 0.01ms !important`
- Settings toggle: `transition: none !important`
- Test: enable system "Reduce motion" → panel appears instantly, claims appear instantly, margin snaps.

**E2 — Accessibility**
- TopBar: `aria-expanded` on menu button, `aria-controls="side-panel"`
- SidePanel root:
  - Desktop ≥768px: `role="complementary"` (NOT modal — main content stays interactive)
  - Mobile <768px: `role="dialog"` + `aria-modal="true"`
  - Use `$effect` watching `open` + viewport width to toggle role
  - Mobile open: focus → close button. Mobile close: focus → menu button.
  - Desktop: do NOT steal focus on open.
- Escape key: closes panel on both viewports (document-level listener, added/removed in `$effect`)
- ClaimCards: `aria-expanded` on detail toggle
- ClaimsView: `aria-live="polite"` on container
- Pass check: Tab through full UI. Lighthouse accessibility score >90.

**E3 — Cross-Browser & Performance**
Desktop (Chrome/Firefox/Safari):
- Panel slides in from right smoothly
- Main content margin-right transition smooth
- Panel scrolls independently from main content
- No layout thrashing (check Performance panel)
- Panel width: exactly 380px

Mobile Safari:
- Full-width overlay
- Body scroll locked when panel open
- No rubber-banding on panel scroll (`overscroll-behavior: contain` on `.side-panel`)

Mobile Chrome: same as Safari checks.
npx tsx --env-file=.env [ingest-batch.ts](http://_vscodecontentref_/3) --wave 1 --retry --fail-fast --pre-scan
---

### ─── PHASE F: Production Deploy ───

**F1 — Font & Token Audit**
- Verify Google Fonts `<link>` tags in `src/app.html` (not just layout): Cormorant Garamond (300/400/600) + JetBrains Mono (400)
- Add `<link rel="preconnect" href="https://fonts.googleapis.com">` and gstatic
- Verify `src/styles/design-tokens.css` includes `--color-amber: #C4A882` (used in Phase 4)
- Run Lighthouse: Performance + Accessibility >90

**F2 — Build & Smoke Test**
```bash
pnpm build  # fix any type errors
pnpm preview
# Test: load → submit question → open panel → claims populate → Sources view → History tab → close panel
# Test mobile 375px: overlay + backdrop + body scroll lock
# Test tablet 768px: 380px panel + content reflow
```

**F3 — Deploy**
```bash
git add -A
git commit -m "feat: Phase 3c UI — side panel, references panel, design system B"
git push origin main
# Monitor: GitHub Actions deploy (~3-5 min)
# Post-deploy: curl /api/health | jq . then test on production URL
```

---

## Prompt-to-Model Reference

| Prompt | Source | Model | Status |
|--------|--------|-------|--------|
| A1 TopBar | impl-plan verbatim | Sonnet | ✅ Done |
| **A2 SidePanel** | **This guide (new prompt)** | Sonnet | ❌ Needs rebuild |
| A3 TabStrip | impl-plan + context tweak | Sonnet | ⚠️ Move to panel/ |
| A4 Settings/History | impl-plan verbatim | Sonnet | ⚠️ Move to panel/ |
| B1 Types & Store | impl-plan + AnalysisPhase fix | Sonnet | ⬜ |
| B2 ClaimBadge | impl-plan verbatim | Sonnet | ⬜ |
| B3 RelationTag & Row | impl-plan verbatim | Sonnet | ⬜ |
| B4 ClaimCard | impl-plan verbatim | Sonnet | ⬜ |
| B5 ClaimsView | impl-plan verbatim | Sonnet | ⬜ |
| C1 SourcesView | impl-plan verbatim | Sonnet | ⬜ |
| C2 ViewToggle | impl-plan verbatim | Sonnet | ⬜ |
| C3 StatusBar | impl-plan verbatim | Sonnet | ⬜ |
| C4 ReferencesTab | impl-plan verbatim | Sonnet | ⬜ |
| **D0 Engine extraction** | **This guide (new prompt)** | **Opus** | ⬜ |
| D1 SSE handler | impl-plan + event format fix | **Opus** | ⬜ |
| D2 Back-references | impl-plan verbatim | **Opus** | ⬜ |
| D3 History integration | impl-plan verbatim | **Opus** | ⬜ |
| **D4 Page wiring** | **This guide (new prompt)** | **Opus** | ⬜ |
| E1 Reduced motion | impl-plan + panel subs | Sonnet | ⬜ |
| E2 Accessibility | impl-plan + panel ARIA | Sonnet | ⬜ |
| E3 Cross-browser | impl-plan + panel checks | Sonnet | ⬜ |
| F1 Font & token audit | This guide | Sonnet | ⬜ |
| F2 Build & smoke test | This guide | Sonnet | ⬜ |

**Bold** = new or substantially modified vs impl-plan. All others: copy verbatim from sophia-impl-plan.docx.

---

## Immediate Corrections Needed (Before Phase B)

1. **Fix `--nav-height` token to 44px** in `src/styles/design-tokens.css`
2. **Replace BottomSheet with SidePanel**: delete `src/lib/components/sheet/BottomSheet.svelte`, create `src/lib/components/panel/SidePanel.svelte` using prompt above
3. **Move panel components**: `sheet/` → `panel/` (TabStrip, SettingsTab, HistoryTab, remove SheetPanel)
4. **Simplify `+layout.svelte`**: keep TopBar only; remove all panel state and imports
5. **Create `src/lib/components/panel/` directory** (replace `src/lib/components/sheet/`)

---

## SSE Event Format (Canonical Reference)

Phase 2 (existing — do not change):
```typescript
{ type: 'pass_start', pass: PassType }
{ type: 'pass_chunk', pass: PassType, content: string }
{ type: 'pass_complete', pass: PassType }
{ type: 'metadata', total_input_tokens, total_output_tokens, duration_ms }
{ type: 'error', message: string }
```

Phase 3c additions (new):
```typescript
{ type: 'claims', pass: AnalysisPhase, claims: Claim[] }
{ type: 'relations', pass: AnalysisPhase, relations: RelationBundle[] }
```

Phase 4 additions (future):
```typescript
{ type: 'gap_detected', query: string, reason: string }
{ type: 'gap_searching', query: string }
{ type: 'gap_result', found: boolean, source?: string, tier?: number }
```

---

## Common Troubleshooting

**Claims don't appear in panel:**
Check Network tab for `claims` SSE events → if absent, check server logs for extraction errors. If events present but panel empty, verify `sseHandler` calls `referencesStore.addClaims`.

**Main content doesn't reflow on desktop:**
Verify `.panel-open` class toggles on `.main-content`. CSS rule must be inside `@media (min-width: 768px)`. Cubic-bezier must match SidePanel transition timing exactly.

**Panel overlaps main content on mobile:**
`@media (max-width: 767px)` must NOT apply `margin-right` to `.main-content.panel-open`. Panel uses `width: 100vw` overlay pattern on mobile.

**Fonts don't load on production:**
Move Google Fonts `<link>` to `src/app.html`. Check CSP headers aren't blocking `fonts.googleapis.com`. Consider self-hosting in `static/fonts/` as fallback.

**Escape key doesn't close panel:**
Add document-level keydown listener inside `$effect` watching `open` prop. Remove on cleanup. `if (e.key === 'Escape' && open) onClose()`.

---

## Phase 4+ Preview (Future Phases)

- **Phase 4**: Web search gap-fill (Tavily), conversation persistence (SurrealDB), follow-up questions, IP rate limiting
- **Phase 5**: Auth (Clerk or Auth.js), per-user rate limits, user conversation history, lens/depth selectors
- **Phase 6**: Knowledge graph visualisation, argument provenance, citation tracking
- **Phase 7**: Multi-language, domain expansion, open API

Full prompt guide: `docs/design/sophia-phases-4-7-prompt-guide.md`

