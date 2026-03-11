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
