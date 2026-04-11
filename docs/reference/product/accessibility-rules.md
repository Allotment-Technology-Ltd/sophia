---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting reference only. Use docs/sophia/ for current SOPHIA source-of-truth guidance.

# SOPHIA Accessibility Rules

## Color and Contrast

1. All text that carries meaning must satisfy WCAG 2.1 AA contrast:
   - normal text: at least 4.5:1
   - large text (>= 24px regular or >= 18.66px bold): at least 3:1
2. On dark surfaces, primary heading text should use `var(--color-text)` unless a different token is explicitly verified for AA contrast.
3. `var(--color-dim)` is decorative only and must not be used for essential body copy, headings, labels, or controls.

## Card Heading Rule

1. Card headings (`h1`-`h6` inside card containers) default to `var(--color-text)` via global base styles.
2. Do not rely on browser default heading/button colors for card titles.
3. Any component-specific heading color override must document and preserve AA contrast on its background.

## Interactive Controls

1. `button`, `input`, `select`, and `textarea` must inherit app typography and text color from the design system unless explicitly overridden.
2. Focus indicators must remain visible (`:focus-visible`) and not be removed.

## Typography Rules

1. The `--font-display` token (Cormorant Garamond) is restricted to public landing page hero and section headings at ≥32px and font-weight ≥500. It must not be used for body copy, application headings, card text, reasoning readouts, or any text below 32px.

2. The `--font-prose` token (Inter) must be used for all reasoning readout containers (analysis, critique, synthesis pass text). Apply via the `.reasoning-prose` class.

3. The `--font-body` and `--font-ui` tokens (Inter) must be used for all application body copy, card content, and UI controls.

4. Minimum body text size is 1rem (16px). Text below 0.875rem (14px) must only be used for non-essential decorative labels.

5. Minimum line-height for paragraph text is 1.65. Reasoning readouts use 1.75.

6. `max-width: 72ch` must be applied to all long-form prose containers to prevent unreadably wide line lengths.
