---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Design System
## Version 2.0 — Design B (Locked)
**Status:** Locked · February 2026  
**Supersedes:** sophia-brand-design-system.md v1.0  
**Change:** Full dark-mode-first aesthetic selected (Design B). All light-mode-first specifications from v1.0 are superseded. Brand personality, voice, and accessibility principles are unchanged.

---

## Part 1: Brand Personality

Unchanged from v1.0. SOPHIA embodies five traits:

1. **Socratic and Humble** — asks questions, does not pronounce, invites participation, acknowledges uncertainty
2. **Rigorous and Honest** — shows its work, does not hide complexity, presents competing views equally
3. **Accessible and Clear** — no jargon without explanation, intelligence without pretension, patient
4. **Inviting and Patient** — warm not cold, encourages deeper thinking, no pressure or urgency
5. **Practical and Grounded** — focused on real decisions, useful not decorative

### Visual Aesthetic (Updated)

Design B is inspired by:
- **Contemplative software** (Obsidian dark mode, iA Writer night, Linear): focused, calm, distraction-free
- **Editorial print design**: typographically led, generous negative space, structural hierarchy through type not colour
- **Astronomical instruments**: precision, subtlety, the sense that something is being calculated carefully
- **Your existing work (PLOT)**: constraint as kindness, clear without wasted motion

**What it is NOT:** corporate, gamified, flashy, urgent, academic, high-contrast brutalist, pure-black OLED maximalism.

---

## Part 2: Colour Palette

Design B is dark-mode-first. There is no light mode variant for Phase 2. Light mode may be added in Phase 5 if user research demands it.

### Core Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#1A1917` | Main app canvas — every screen |
| `--color-surface` | `#141312` | Nav bar, contained cards, input boxes |
| `--color-surface-raised` | `#201F1D` | Hover states, modals, raised elements |
| `--color-surface-sunken` | `#111110` | Inset areas, code blocks, deep nesting |

All backgrounds are warm-tinted. `#1A1917` is not grey — it has a brown/amber undertone. Never substitute a pure grey or cool-toned dark.

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text` | `#E8E6E1` | Primary text: headings, pass content, labels |
| `--color-muted` | `#9E9A93` | Secondary text: pass body copy, descriptions |
| `--color-dim` | `#4A4845` | Tertiary text: timestamps, inactive states, hints |
| `--color-border` | `#2E2C29` | All borders and dividers — 1px, consistent |

### Accents

Each accent maps to a semantic role and must not be used interchangeably.

| Token | Hex | Semantic role |
|-------|-----|---------------|
| `--color-sage` | `#7FA383` | Analysis pass · Primary CTA · Active states · Brand mark |
| `--color-sage-bg` | `rgba(127,163,131,0.10)` | Analysis badge background · Active item tint |
| `--color-sage-border` | `rgba(127,163,131,0.25)` | Analysis badge border · Focus ring base |
| `--color-copper` | `#D4936F` | Critique pass · Follow-up CTA · Secondary actions |
| `--color-copper-bg` | `rgba(212,147,111,0.10)` | Critique badge background · Warning tints |
| `--color-copper-border` | `rgba(212,147,111,0.25)` | Critique badge border |
| `--color-blue` | `#6FA3D4` | Synthesis pass · Links · Epistemic status · Trust |
| `--color-blue-bg` | `rgba(111,163,212,0.10)` | Synthesis badge background |
| `--color-blue-border` | `rgba(111,163,212,0.25)` | Synthesis badge border |

### Colour Rules

1. Never use pure `#000000` or `#FFFFFF`. Always use the warm-tinted tokens.
2. Accents are used sparingly. One accent dominates per screen state: sage on Analysis, copper on Critique/follow-up, blue on Synthesis.
3. Never use accent colours for body text. They are structural and interactive signals, not prose.
4. No colour carries information alone — always pair with a label, icon, or structural position.

### Contrast Ratios (WCAG AA)

| Combination | Ratio | Pass |
|-------------|-------|------|
| `--color-text` (#E8E6E1) on `--color-bg` (#1A1917) | 9.5:1 | ✓ AAA |
| `--color-muted` (#9E9A93) on `--color-bg` (#1A1917) | 5.2:1 | ✓ AA |
| `--color-sage` (#7FA383) on `--color-bg` (#1A1917) | 4.6:1 | ✓ AA |
| `--color-copper` (#D4936F) on `--color-bg` (#1A1917) | 4.9:1 | ✓ AA |
| `--color-dim` (#4A4845) on `--color-bg` (#1A1917) | 2.1:1 | ✗ — dim is for decorative/non-essential text only |

`--color-dim` must never be used for text that carries essential meaning.

---

## Part 3: Typography

Two typefaces. No others.

### Cormorant Garamond — Display & Body

Used for everything a human reads: headings, philosophical pass content, the user's submitted question, the follow-up prompt, epistemic status text.

**Google Fonts import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
```

**Self-hosted alternative (preferred for production):** Download from Google Fonts and serve from `/static/fonts/`.

| Level | Size | Weight | Line height | Usage |
|-------|------|--------|-------------|-------|
| Display 1 | `clamp(2.5rem, 5vw, 4rem)` | 300 | 1.05 | Hero heading on query screen |
| Display 2 | `2rem` | 300 | 1.1 | Section headings in results |
| Display 3 | `1.4rem` | 400 | 1.2 | Card titles, pass names |
| Body | `1rem` | 300 | 1.85 | All pass content — Analysis, Critique, Synthesis |
| Body italic | `1rem` | 300 italic | 1.85 | User's submitted question, follow-up prompt |
| Small | `0.9rem` | 300 | 1.7 | Sub-headings within passes |

The `1.85` body line-height is non-negotiable. It makes philosophical prose readable, not dense. Do not reduce it.

### JetBrains Mono — UI Chrome

Used for everything structural: labels, badges, buttons, navigation links, status indicators, metadata, timestamps.

**Google Fonts import:**
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');
```

| Level | Size | Weight | Letter-spacing | Usage |
|-------|------|--------|----------------|-------|
| UI default | `0.75rem` | 400 | `0.10em` | Nav links, button text |
| Eyebrow | `0.62rem` | 300 | `0.18–0.22em` | Section labels, pass indicators (uppercase) |
| Metadata | `0.6rem` | 300 | `0.08em` | Timestamps, token counts, hints |
| Badge | `0.62rem` | 400 | `0.10em` | Pass badges (uppercase) |

### Typography Rules

- **Italics** are expressive and used intentionally: the user's question is always rendered in Cormorant italic, as is the follow-up prompt ("Any follow-up questions?"). Never use bold for emphasis in philosophical body content — use italics.
- **Letter-spacing** applies only to monospace UI chrome. Never apply letter-spacing to Cormorant body copy.
- **Uppercase** is used only for monospace eyebrows and badges. Never uppercase Cormorant.
- **Font fallbacks:** `'Cormorant Garamond', Georgia, 'Times New Roman', serif` and `'JetBrains Mono', 'Courier New', monospace`.

---

## Part 4: Spacing

8px base unit. All spacing values are multiples of 4 or 8. No arbitrary values.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Badge internal padding, tight icon gaps |
| `--space-2` | `8px` | Between icon and label, tight component gaps |
| `--space-3` | `16px` | Component internal padding (small), related element gaps |
| `--space-4` | `24px` | Card internal padding, section item gaps |
| `--space-5` | `40px` | Between pass sections, major content blocks |
| `--space-6` | `64px` | Page-level vertical padding, hero breathing room |
| `--space-7` | `96px` | Maximum separation — screen-level vertical rhythm |

---

## Part 5: Layout

### No Persistent Sidebar

Design B uses no left sidebar by default. Conversation history is accessed via a "History" link in the nav bar, which opens a slide-in drawer. Every screen uses the full viewport width with a centred content column.

### Content Widths

| Purpose | Max-width | Notes |
|---------|-----------|-------|
| Query input box | `700px` | Centred, comfortable typing width |
| Pass content (results) | `680px` | Centred, optimal reading line length |
| Nav bar | `100%` | Full width, no max |
| Pass navigator (results screen) | `200px` | Fixed left column on results screen only |

### Screen Structure

All screens: `48px` fixed nav bar → scrollable content beneath. The query screen and loading screen are vertically centred within the viewport height minus the nav bar. The results screen scrolls naturally.

### Responsive Breakpoints

| Breakpoint | Width | Changes |
|------------|-------|---------|
| Mobile | `< 640px` | Nav collapses to wordmark + hamburger. Pass navigator hidden. Single-column layout. |
| Tablet | `640px – 1024px` | Pass navigator shows as top tabs, not left column. Input/content max-width relaxed. |
| Desktop | `> 1024px` | Full layout as specified. Pass navigator as left column on results. |

### Grid Texture

Applied to full-page hero areas only: the query screen, the loading/analysing screen. Not applied to content reading areas, nav bar, cards, or the results content pane.

```css
.hero-area {
  position: relative;
}

.hero-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--color-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
  background-size: 60px 60px;
  opacity: 0.35;
  pointer-events: none;
  z-index: 0;
}

.hero-area > * {
  position: relative;
  z-index: 1;
}
```

---

## Part 6: Components

### Navigation Bar

```
Height:      48px, position: fixed, top: 0, width: 100%
Background:  --color-surface (#141312)
Border:      1px solid --color-border, bottom only
Z-index:     100
```

**Wordmark:** Cormorant Garamond 300, `1.3rem`, letter-spacing `0.3em`, uppercase, color `--color-text`. Prefixed by `✦` glyph in `--color-sage`.

**Nav links:** JetBrains Mono, `0.62rem`, letter-spacing `0.10em`, color `--color-dim`. Hover: `--color-muted`. Active: `--color-text`.

**Nav actions (right):** Two buttons maximum. Primary: border `1px solid --color-sage`, color `--color-sage`, border-radius `2px`. Ghost: border `1px solid --color-border`, color `--color-dim`.

**Context display (results + loading screens):** Centre of nav bar shows the user's submitted question in Cormorant italic, `0.85rem`, color `--color-muted`, truncated to one line with ellipsis. On the loading screen, a live status indicator (`● Pass 1 of 3`) appears to the right of the question in `--color-sage`, mono `0.6rem`.

### Question Input

The primary entry point. A single bordered container with three zones: label, textarea, action row.

```
Container:   background --color-surface, border 1px solid --color-border, border-radius 4px
Max-width:   700px, centred
Border (focused): 1px solid --color-sage
Transition:  border-color 200ms ease
```

**Label zone:** `padding: 12px 20px 0`. JetBrains Mono, `0.6rem`, letter-spacing `0.18em`, uppercase, color `--color-muted`. Text: "Your question or argument".

**Textarea zone:** `padding: 8px 20px 16px`. JetBrains Mono, `0.9rem`, weight 300, color `--color-text`. Placeholder color `--color-dim`. `min-height: 120px`, `resize: vertical`. No border of its own — the container provides it.

**Action row:** `padding: 10px 20px`, border-top `1px solid --color-border`. Flex, space-between. Left: hint text in Mono `0.6rem` `--color-dim` ("Be specific · More context → richer analysis"). Right: primary CTA button.

**Example pills** (below the input container): `border-radius: 100px`, `padding: 6px 16px`, border `1px solid --color-border`, color `--color-dim`, Mono `0.68rem`. Hover: border `--color-sage`, color `--color-sage`, background `--color-sage-bg`. Clicking populates the textarea. Does not submit.

### Pass Progress Tracker

Shown on the Analysing and Results screens. Three equal-width tabs in a row.

```
Height:      56px
Background:  --color-surface
Border:      1px solid --color-border (full container), border-right on each tab
```

Each tab: numbered circle indicator + pass name + sub-status.

**Active state:** 2px coloured bottom border (pass colour). Circle filled with pass colour, text `--color-text`.

**Pending state:** Circle border `1px solid --color-border`, background transparent, text `--color-dim`. Sub-status: "Waiting".

**Completed state:** Circle filled with pass colour at 40% opacity. Bottom border at 30% opacity.

| Pass | Colour token | Name |
|------|-------------|------|
| 01 — Analysis | `--color-sage` | Analysis |
| 02 — Critique | `--color-copper` | Critique |
| 03 — Synthesis | `--color-blue` | Synthesis |

**Active pulse animation:** The active pass circle has a box-shadow pulse — `node-pulse` keyframe, 2s ease-in-out infinite. Suppressed under `prefers-reduced-motion`.

### Pass Cards

Each analytical pass renders as a distinct card. Cards are stacked vertically and separated by `1px solid --color-border` — flush, no gap between them.

```
Background:    --color-surface (#141312)
Border:        1px solid --color-border (full card)
Border-radius: 3px on the outermost wrapper only
```

**Card header:** `padding: 14px 20px`. Flex, align-items centre, gap `12px`. Border-bottom `1px solid --color-border`. Contains: pass badge + pass title (Cormorant Garamond 400, `1.5rem`, `--color-text`).

**Card body:** `padding: 18px 20px`. Cormorant Garamond 300, `1rem`, line-height `1.85`, color `--color-muted`. Sub-headings within body: JetBrains Mono, `0.58rem`, uppercase, letter-spacing `0.18em`, color `--color-dim`, margin-bottom `8px`.

**Streaming cursor:** While a pass is streaming, a `2px` vertical cursor in `--color-sage` blinks at the end of the text content (`cursor-blink` keyframe, `0.75s step-end infinite`). Removed when streaming completes for that pass.

**Fade-in on arrival:** Each card fades in when its pass begins streaming (`fadeIn` keyframe, `400ms ease forwards`, from `opacity: 0, translateY(8px)` to `opacity: 1, translateY(0)`).

### Badges

```
Font:          JetBrains Mono 400, 0.62rem, letter-spacing 0.10em, text-transform uppercase
Padding:       4px 12px
Border-radius: 2px (never pill-shaped)
```

| Variant | Background | Color | Border |
|---------|------------|-------|--------|
| Analysis | `--color-sage-bg` | `--color-sage` | `1px solid --color-sage-border` |
| Critique | `--color-copper-bg` | `--color-copper` | `1px solid --color-copper-border` |
| Synthesis | `--color-blue-bg` | `--color-blue` | `1px solid --color-blue-border` |
| Live/Streaming | `--color-sage-bg` | `--color-sage` | none |
| Waiting | transparent | `--color-dim` | `1px solid --color-border` |

### Buttons

```
Font:          JetBrains Mono 400, 0.7rem, letter-spacing 0.14em, text-transform uppercase
Padding:       11px 28px
Border-radius: 2px
Min-height:    44px (touch accessibility)
Transition:    all 150ms ease
```

| Variant | Background | Color | Border |
|---------|------------|-------|--------|
| Primary (sage) | `--color-sage` | `--color-bg` | none |
| Secondary (copper) | transparent | `--color-copper` | `1px solid rgba(212,147,111,0.4)` |
| Ghost | transparent | `--color-muted` | `1px solid --color-border` |
| Destructive | transparent | `#C44` | `1px solid rgba(204,68,68,0.4)` |

**Hover states:** Primary: `opacity: 0.88`. Secondary: `background: --color-copper-bg`. Ghost: `background: rgba(255,255,255,0.04)`.

**Focus visible:** `outline: 2px solid --color-sage; outline-offset: 2px`. Never suppress focus outlines.

**Disabled:** `opacity: 0.4`, `cursor: not-allowed`, `pointer-events: none`.

### Pass Navigator (Results Screen)

A `200px` fixed-width left column on the results screen on desktop. On tablet/mobile, collapses to top tabs above the content pane.

```
Width:         200px
Background:    --color-surface
Border-right:  1px solid --color-border
Padding:       16px 0
```

Each item: `padding: 10px 16px`, numbered pass, pass name, sub-description, transition on hover.

**Active item:** `border-left: 2px solid [pass colour]`, `background: [pass colour tint]`. Clicking smoothly scrolls to that pass section.

**Bottom of navigator:** copper "Ask follow-up →" CTA button.

### Follow-Up Component

Appears after all three passes are complete. Separated from the pass cards by `1px solid --color-border`.

**Prompt text:** Cormorant Garamond 300 italic, `1rem`, color `--color-muted`. Text: "Any follow-up questions?".

**Input:** background `--color-surface`, border `1px solid --color-border`. Focus border: `1px solid --color-copper`. Cormorant Garamond 300 italic, `0.9rem`, color `--color-dim` as placeholder.

**CTA button:** Secondary (copper) variant.

**Secondary link:** "Start a new analysis" — JetBrains Mono `0.65rem`, color `--color-dim`, underline on hover.

**Follow-up thread:** When a follow-up is submitted, the three original pass cards collapse to a brief summary. The thread entry appears below: `border-left: 2px solid --color-copper`, `background: --color-copper-bg`, `padding: 16px 20px`. User question: Cormorant italic, muted. Response body: Cormorant 300, `1rem`, `1.85` line-height. Multiple follow-ups append in sequence.

### Loading / Analysing State

Full-page centred layout on `--color-bg` with grid texture. Two CSS-animated concentric rings around a breathing symbol.

```
Outer ring:    180px diameter, border: 1px solid rgba(127,163,131,0.2)
               animation: orbit-spin 8s linear infinite
               Dot at ring top: 6px, background --color-sage, box-shadow: 0 0 8px --color-sage

Inner ring:    140px diameter, border: 1px solid rgba(127,163,131,0.12)
               animation: orbit-spin 12s linear infinite reverse

Centre symbol: ✦ — Cormorant Garamond, 2.5rem, --color-sage
               animation: symbol-breathe 3s ease-in-out infinite
```

**Phase label:** JetBrains Mono, `0.65rem`, letter-spacing `0.22em`, uppercase, `--color-sage`.

**Description:** Cormorant Garamond italic, `1.5rem`, `--color-text`. Rotates per pass:
- Pass 1: "Mapping the philosophical landscape…"
- Pass 2: "Finding the weakest premises…"
- Pass 3: "Integrating tensions…"

**Three-node progress track:** Three `8px` dots in a row below the description. Active: filled `--color-sage`. Pending: border `1px solid --color-border`.

**Optional thinking log:** `--color-surface` container, max-width `560px`, centred below the orbital. Mono `0.65rem`. Entries append from bottom with `log-appear` animation. Timestamps in `--color-dim`. Conceptual descriptors (not technical) in `--color-sage`.

### Error State

```
Container:  border-left: 3px solid #C44, background: rgba(204,68,68,0.08)
            padding: 16px 20px, border-radius: 0 3px 3px 0
```

**Label:** Mono, `0.58rem`, uppercase, `#C44`.

**Message:** Cormorant 300, `1rem`, `--color-muted`. Copy: "We hit a temporary issue. Please try again."

**Actions:** Ghost button "Try again" + text link "Start a new analysis".

---

## Part 7: Motion & Animation

### Keyframes

```css
/* Pass content arrival */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Streaming cursor blink */
@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* Loading symbol breathe */
@keyframes symbol-breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50%       { opacity: 1;   transform: scale(1.05); }
}

/* Orbital ring spin */
@keyframes orbit-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Active pass node pulse */
@keyframes node-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(127,163,131,0.15); }
  50%       { box-shadow: 0 0 0 8px rgba(127,163,131,0.06); }
}

/* Thinking log entry appear */
@keyframes log-appear {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### Timing Reference

| Animation | Duration | Easing | Purpose |
|-----------|----------|--------|---------|
| Pass fade-in | 400ms | ease | Pass section arrives |
| Cursor blink | 750ms | step-end | Streaming in progress |
| Symbol breathe | 3000ms | ease-in-out | Loading active |
| Orbital outer | 8000ms | linear | Loading active |
| Orbital inner | 12000ms | linear | Loading active |
| Node pulse | 2000ms | ease-in-out | Active pass indicator |
| Log appear | 300ms | ease | Log entry appends |
| Button hover | 150ms | ease | Interaction feedback |
| Border focus | 200ms | ease | Focus state transition |

### Motion Rules

1. Every animation has a semantic reason. No decorative motion.
2. Do not use `transform: scale()` on buttons — it reads as gamified.
3. Pass content fade-in is the most important animation — it signals new information has arrived.
4. The loading orbital is the second most important — it communicates careful work, not urgency.

### prefers-reduced-motion

All keyframe animations must be suppressed. The interface must be fully functional without any motion.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Orbital rings become static on reduced-motion. Streaming cursor stops. Pass cards appear instantly. The ✦ symbol is static at full opacity.

---

## Part 8: Voice & Copy

### Principles

- **Clear over clever:** "Your question was submitted" not "We received your intellectual inquiry"
- **Honest over comforting:** "We hit a temporary issue" not "Oops! Something went wrong!"
- **Humble over authoritative:** "This analysis assumes..." not "Here is the truth"
- **Inviting over instructive:** "What's on your mind?" not "Enter your query"

### UI Copy Reference

| Context | ✗ Wrong | ✓ Right |
|---------|---------|---------|
| Input prompt / label | "Enter your query" | "What's on your mind?" |
| Input hint | "50–2000 characters" | "Be specific · More context → richer analysis" |
| Analyse button | "Submit" / "Search" | "Begin analysis →" |
| Loading — Pass 1 | "Processing…" | "Mapping the philosophical landscape…" |
| Loading — Pass 2 | "Running critique" | "Finding the weakest premises…" |
| Loading — Pass 3 | "Generating response" | "Integrating tensions…" |
| Pass tracker — active | "Running" | "Streaming now…" |
| Pass tracker — waiting | "Pending" | "Waiting" |
| Follow-up prompt | "Enter follow-up" | "Any follow-up questions?" |
| New analysis | "Reset" / "Clear" | "Start a new analysis" |
| Empty history | "No analyses found" | "Ready to think? Describe a decision that matters." |
| Error | "ERROR 502" | "We hit a temporary issue. Please try again." |
| Nav — primary action | "New Chat" | "+ New" |
| Nav — history | "Sessions" | "History" |

---

## Part 9: CSS Custom Properties

Copy this block into `src/styles/design-tokens.css` at the start of Phase 2. All component CSS references these variables. Never hard-code hex values in component files.

```css
/* ============================================================
   SOPHIA Design Tokens — Design B
   src/styles/design-tokens.css
   ============================================================ */

:root {

  /* ── Backgrounds ── */
  --color-bg:             #1A1917;   /* Main canvas */
  --color-surface:        #141312;   /* Nav, cards, input containers */
  --color-surface-raised: #201F1D;   /* Hover states, modals */
  --color-surface-sunken: #111110;   /* Code blocks, deep inset */

  /* ── Text ── */
  --color-text:           #E8E6E1;   /* Primary — headings, pass content */
  --color-muted:          #9E9A93;   /* Secondary — body copy, descriptions */
  --color-dim:            #4A4845;   /* Tertiary — labels, timestamps, inactive */

  /* ── Borders ── */
  --color-border:         #2E2C29;   /* All borders and dividers, 1px */

  /* ── Accent: Sage (Analysis, Primary CTA) ── */
  --color-sage:           #7FA383;
  --color-sage-bg:        rgba(127, 163, 131, 0.10);
  --color-sage-border:    rgba(127, 163, 131, 0.25);

  /* ── Accent: Copper (Critique, Follow-up) ── */
  --color-copper:         #D4936F;
  --color-copper-bg:      rgba(212, 147, 111, 0.10);
  --color-copper-border:  rgba(212, 147, 111, 0.25);

  /* ── Accent: Blue (Synthesis, Links) ── */
  --color-blue:           #6FA3D4;
  --color-blue-bg:        rgba(111, 163, 212, 0.10);
  --color-blue-border:    rgba(111, 163, 212, 0.25);

  /* ── Typography ── */
  --font-display: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
  --font-ui:      'JetBrains Mono', 'Courier New', monospace;

  /* Size scale */
  --text-d1:    clamp(2.5rem, 5vw, 4rem);  /* Hero heading */
  --text-d2:    2rem;                        /* Section title */
  --text-d3:    1.4rem;                      /* Card title */
  --text-body:  1rem;                        /* Pass content */
  --text-ui:    0.75rem;                     /* Buttons, nav links */
  --text-label: 0.62rem;                     /* Eyebrows, badges */
  --text-meta:  0.6rem;                      /* Timestamps, hints */

  /* Line heights */
  --leading-display: 1.05;
  --leading-card:    1.2;
  --leading-body:    1.85;   /* Non-negotiable for philosophical prose */
  --leading-ui:      1.5;

  /* ── Spacing (8px base) ── */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  16px;
  --space-4:  24px;
  --space-5:  40px;
  --space-6:  64px;
  --space-7:  96px;

  /* ── Border radius ── */
  --radius-sm:   2px;    /* Buttons, badges */
  --radius-md:   3px;    /* Cards, inputs */
  --radius-lg:   4px;    /* Larger containers */
  --radius-pill: 100px;  /* Example pills only */

  /* ── Transitions ── */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;

  /* ── Layout ── */
  --nav-height:       48px;
  --content-max:      680px;   /* Pass content */
  --input-max:        700px;   /* Query input */
  --pass-nav-width:   200px;   /* Results left nav */
}
```

---

## Part 10: Accessibility

All principles from v1.0 carry over. Implementation notes specific to Design B:

**Focus rings:** `outline: 2px solid var(--color-sage); outline-offset: 2px`. Applied globally to all interactive elements via `:focus-visible`. Never suppress.

**Touch targets:** All interactive elements minimum `44px` height. On mobile, example pills minimum `44px` height.

**Screen reader:** Nav landmark (`<nav>`), main (`<main>`), and section landmarks (`<section aria-label="Analysis pass">`). Pass cards have ARIA labels reflecting their pass name and streaming status. Live streaming regions use `aria-live="polite"`.

**Keyboard navigation:** Tab order follows visual order on all screens. The pass navigator (results) is tab-navigable. The orbital loading screen provides no keyboard traps. "Skip to content" link as first focusable element.

**Reduced motion:** See Part 7. The interface must be fully usable with no motion.

---

## Part 11: File Structure for Design Implementation

```
src/
├── styles/
│   ├── design-tokens.css      ← All CSS custom properties (Part 9 above)
│   ├── base.css               ← Reset, body defaults, dark bg, font imports
│   ├── typography.css         ← Font imports, type utility classes
│   ├── layout.css             ← Grid texture, breakpoints, content max-widths
│   └── animations.css         ← All @keyframes (Part 7 above)
│
└── components/
    ├── Nav/
    │   └── Nav.svelte
    ├── Input/
    │   ├── QuestionInput.svelte
    │   └── ExamplePills.svelte
    ├── Loading/
    │   ├── Loading.svelte          ← Orbital animation + progress track
    │   └── ThinkingLog.svelte      ← Optional log entries
    ├── Output/
    │   ├── ThreePassOutput.svelte  ← Wrapper, manages streaming state
    │   ├── PassTracker.svelte      ← Three-tab progress bar
    │   ├── PassCard.svelte         ← Single pass card (parameterised)
    │   ├── PassNavigator.svelte    ← Left column nav on results screen
    │   └── EpistemicStatus.svelte  ← Synthesis epistemic summary block
    ├── FollowUp/
    │   ├── FollowUpPrompt.svelte
    │   └── FollowUpThread.svelte
    ├── UI/
    │   ├── Button.svelte
    │   ├── Badge.svelte
    │   └── ErrorState.svelte
    └── Layout/
        └── AppShell.svelte         ← Nav + main, page-level layout
```

---

## Appendix: Design B vs v1.0 Diff

| Element | v1.0 (Light-first) | v2.0 Design B (Dark-first) |
|---------|-------------------|---------------------------|
| Background | `#F8F7F4` off-white | `#1A1917` warm near-black |
| Primary font | Sohne (licensed) | Cormorant Garamond (Google Fonts, free) |
| Monospace | Rec Mono (licensed) | JetBrains Mono (Google Fonts, free) |
| Body size | 18px / 1.7 lh | 16px / 1.85 lh |
| Layout | Sidebar persistent | No persistent sidebar; centred full-width |
| Loading | Pulsing text "Analyzing…" | Orbital ring animation + ✦ symbol |
| Results layout | Sidebar + scrollable content | Pass navigator column + scrollable content |
| Light/dark toggle | System preference toggle planned | Dark only (Phase 5 can add light toggle) |
| Font licensing | Commercial licence required | Google Fonts — free, no licence needed |

The switch from Sohne + Rec Mono to Cormorant Garamond + JetBrains Mono is a meaningful improvement for Phase 2: it eliminates the font licensing cost entirely, and Cormorant Garamond's editorial character is more philosophically appropriate than a clean humanist sans-serif.
