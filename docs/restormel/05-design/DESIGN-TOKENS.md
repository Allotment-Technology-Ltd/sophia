# Restormel Design System - Design Tokens

**Version:** 1.0.0  
**Last Updated:** 2026-03-13

## Overview

This document defines the complete design token system for the Restormel graph-native AI developer platform. These tokens provide a consistent foundation for all UI implementation across the platform.

## Design Principles

1. **Dark-mode first** - All colors optimized for dark backgrounds
2. **Technical credibility over ornament** - Restrained, analytical aesthetic
3. **Calm, analytical interface** - No flashy effects or distracting motion
4. **Graph-inspired visual language** - Patterns that reflect data structures
5. **Semantic color meaning** - Colors have consistent meaning across the system

---

## Color System

### Base Colors

| Token | Value | Usage |
|-------|-------|-------|
| `black` | `#0A0E14` | Pure black, use sparingly for maximum contrast |
| `white` | `#FFFFFF` | Pure white, use sparingly for maximum contrast |

### Neutral Palette

The neutral palette forms the foundation of the interface, providing surfaces, borders, and text hierarchy.

| Token | Value | Description | Usage |
|-------|-------|-------------|-------|
| `ink` | `#0F1419` | Deepest surface | Primary background, canvas |
| `charcoal` | `#1A1F26` | Elevated surface | Panels, cards, raised elements |
| `elevated` | `#212830` | Higher elevation | Modals, popovers, tooltips |
| `slate` | `#2E3440` | Borders | Dividers, subtle backgrounds, borders |
| `steel` | `#8892A6` | Secondary text | Disabled states, placeholders, captions |
| `mist` | `#C4CFDB` | Body text | Standard text color, muted content |
| `paper` | `#E8EDF2` | Primary text | Headings, emphasized text, high contrast |

**Hierarchy:** ink → charcoal → elevated → slate

### Semantic Colors

Semantic colors carry meaning across the entire system. Use consistently to build user understanding.

#### Primary (Path Blue)

**Purpose:** Primary actions, active states, selection, query nodes

| Token | Value | State |
|-------|-------|-------|
| `path-blue` | `#4C8DFF` | Default |
| `path-blue-hover` | `#6BA3FF` | Hover |
| `path-blue-active` | `#3D7AE6` | Active/Pressed |

**Use for:**
- Primary buttons
- Selected nodes in graph
- Active navigation items
- Query nodes
- Links and interactive elements
- Focus states

#### Verified (Signal Teal)

**Purpose:** Verified nodes, supported claims, healthy states, evidence

| Token | Value | State |
|-------|-------|-------|
| `signal-teal` | `#2EC4B6` | Default |
| `signal-teal-hover` | `#4DD4C7` | Hover |
| `signal-teal-active` | `#25AFA3` | Active/Pressed |

**Use for:**
- Verified nodes
- Success states
- Supported claims
- Evidence nodes
- Healthy system states
- Confirmation messages

#### Warning (Amber Insight)

**Purpose:** Unresolved nodes, warnings, claims needing validation, synthesis

| Token | Value | State |
|-------|-------|-------|
| `amber-insight` | `#FFB84D` | Default |
| `amber-insight-hover` | `#FFC570` | Hover |
| `amber-insight-active` | `#E6A63E` | Active/Pressed |

**Use for:**
- Unresolved nodes
- Warning messages
- Claims requiring validation
- Synthesis nodes
- Attention-needed states

#### Error (Coral Alert)

**Purpose:** Contradictions, errors, failed validation, conflicts

| Token | Value | State |
|-------|-------|-------|
| `coral-alert` | `#F25C54` | Default |
| `coral-alert-hover` | `#F4736D` | Hover |
| `coral-alert-active` | `#D94E47` | Active/Pressed |

**Use for:**
- Contradiction nodes
- Error states
- Failed validation
- Destructive actions
- Conflicts in reasoning

#### Reasoning (Violet Depth)

**Purpose:** Inference nodes, reasoning chains, model-generated content

| Token | Value | State |
|-------|-------|-------|
| `violet-depth` | `#9D84B7` | Default |
| `violet-depth-hover` | `#B199C9` | Hover |
| `violet-depth-active` | `#8B72A3` | Active/Pressed |

**Use for:**
- Inference nodes
- Reasoning paths
- AI-generated content
- Logical connections
- Derived conclusions

### Alpha Colors (Transparency)

For backgrounds and subtle accents. Each semantic color has 5%, 10%, and 20% opacity variants.

| Token | Value | Usage |
|-------|-------|-------|
| `path-blue-5` | `rgba(76, 141, 255, 0.05)` | Subtle blue tint |
| `path-blue-10` | `rgba(76, 141, 255, 0.10)` | Selected backgrounds |
| `path-blue-20` | `rgba(76, 141, 255, 0.20)` | Hover backgrounds |
| `signal-teal-5` | `rgba(46, 196, 182, 0.05)` | Subtle teal tint |
| `signal-teal-10` | `rgba(46, 196, 182, 0.10)` | Verified backgrounds |
| `signal-teal-20` | `rgba(46, 196, 182, 0.20)` | Success backgrounds |
| `amber-insight-5` | `rgba(255, 184, 77, 0.05)` | Subtle amber tint |
| `amber-insight-10` | `rgba(255, 184, 77, 0.10)` | Warning backgrounds |
| `amber-insight-20` | `rgba(255, 184, 77, 0.20)` | Attention backgrounds |
| `coral-alert-5` | `rgba(242, 92, 84, 0.05)` | Subtle coral tint |
| `coral-alert-10` | `rgba(242, 92, 84, 0.10)` | Error backgrounds |
| `coral-alert-20` | `rgba(242, 92, 84, 0.20)` | Destructive backgrounds |
| `violet-depth-5` | `rgba(157, 132, 183, 0.05)` | Subtle violet tint |
| `violet-depth-10` | `rgba(157, 132, 183, 0.10)` | Reasoning backgrounds |
| `violet-depth-20` | `rgba(157, 132, 183, 0.20)` | Inference backgrounds |
| `slate-30` | `rgba(46, 52, 64, 0.30)` | Neutral backgrounds |
| `slate-50` | `rgba(46, 52, 64, 0.50)` | Stronger neutral backgrounds |

---

## Typography

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `font-sans` | `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | UI text, body copy, headings |
| `font-mono` | `'IBM Plex Mono', 'SF Mono', Monaco, Consolas, monospace` | Code, IDs, technical data, node identifiers |

**Notes:**
- Inter should be loaded from Google Fonts or self-hosted
- IBM Plex Mono should be loaded from Google Fonts or self-hosted
- Fallback fonts ensure readability if custom fonts fail

### Font Sizes

| Token | Rem | Pixels | Usage |
|-------|-----|--------|-------|
| `text-xs` | `0.75rem` | 12px | Captions, metadata, very small labels |
| `text-sm` | `0.875rem` | 14px | Body text, form inputs, compact UI |
| `text-base` | `1rem` | 16px | Default body text |
| `text-lg` | `1.125rem` | 18px | Large body text, emphasized content |
| `text-xl` | `1.25rem` | 20px | H5 headings, large labels |
| `text-2xl` | `1.5rem` | 24px | H4 headings |
| `text-3xl` | `1.875rem` | 30px | H3 headings |
| `text-4xl` | `2.25rem` | 36px | H2 headings |
| `text-5xl` | `3rem` | 48px | H1 headings, hero text |

**Heading Scale:** Don't apply font-size utilities to headings—they have default styles in theme.css

### Font Weights

| Token | Value | Usage |
|-------|-------|-------|
| `font-normal` | `400` | Regular body text, default weight |
| `font-medium` | `500` | Labels, subheadings, subtle emphasis |
| `font-semibold` | `600` | Headings, strong emphasis, important UI |
| `font-bold` | `700` | Very strong emphasis (use sparingly) |

**Default weights:**
- Body text: `font-normal` (400)
- Headings: `font-semibold` (600)
- Buttons/labels: `font-medium` (500)

### Line Heights

| Token | Value | Usage |
|-------|-------|-------|
| `leading-tight` | `1.25` | Headings, compact text blocks |
| `leading-normal` | `1.5` | Body text, default line height |
| `leading-relaxed` | `1.75` | Long-form content, documentation |

### Letter Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `tracking-tight` | `-0.01em` | Large headings (tighter tracking improves readability) |
| `tracking-normal` | `0em` | Default tracking for most text |
| `tracking-wide` | `0.025em` | Small caps, uppercase labels |

---

## Spacing Scale

Based on a 4px base unit. Use for padding, margin, gap, and positioning.

| Token | Rem | Pixels | Usage |
|-------|-----|--------|-------|
| `space-0` | `0rem` | 0px | Reset spacing |
| `space-1` | `0.25rem` | 4px | Minimal spacing, tight layouts |
| `space-2` | `0.5rem` | 8px | Tight spacing, dense UIs |
| `space-3` | `0.75rem` | 12px | Small spacing |
| `space-4` | `1rem` | 16px | **Base unit** - default spacing |
| `space-5` | `1.25rem` | 20px | Medium spacing |
| `space-6` | `1.5rem` | 24px | Large spacing |
| `space-8` | `2rem` | 32px | Extra large spacing |
| `space-10` | `2.5rem` | 40px | Section spacing |
| `space-12` | `3rem` | 48px | Large section spacing |
| `space-16` | `4rem` | 64px | Major section spacing |
| `space-20` | `5rem` | 80px | Page section spacing |

**Common patterns:**
- Card padding: `space-6` (24px)
- Button padding: `space-4` horizontal, `space-3` vertical
- Stack spacing: `space-4` to `space-6`
- Section spacing: `space-12` to `space-20`

---

## Border Radius

Soft, rounded corners throughout. Never use sharp corners except for technical/code elements.

| Token | Rem | Pixels | Usage |
|-------|-----|--------|-------|
| `radius-none` | `0rem` | 0px | No rounding (technical elements) |
| `radius-sm` | `0.25rem` | 4px | Subtle rounding for small elements |
| `radius-base` | `0.375rem` | 6px | **Default** - buttons, inputs, badges |
| `radius-md` | `0.5rem` | 8px | Cards, smaller panels |
| `radius-lg` | `0.75rem` | 12px | Large cards, panels |
| `radius-xl` | `1rem` | 16px | Modals, emphasized panels |
| `radius-2xl` | `1.5rem` | 24px | Hero elements, feature cards |
| `radius-full` | `9999px` | ∞ | Pills, avatars, fully rounded |

**Default component radii:**
- Buttons/inputs: `radius-base` (6px)
- Cards: `radius-lg` (12px)
- Modals: `radius-xl` (16px)
- Graph nodes: `radius-md` (8px)

---

## Border Width

| Token | Value | Usage |
|-------|-------|-------|
| `border-0` | `0px` | No border |
| `border-1` | `1px` | **Default** - standard borders |
| `border-2` | `2px` | Emphasized borders, focus states, semantic states |
| `border-4` | `4px` | Very strong emphasis (rare) |

**Semantic states:** Use `border-2` for selected, verified, warning, or error states.

---

## Elevation (Box Shadows)

Dark-mode optimized shadows. Stronger opacity for better definition on dark backgrounds.

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-none` | `none` | Flat elements, no elevation |
| `shadow-sm` | `0 1px 2px 0 rgba(0, 0, 0, 0.3)` | Subtle hover states |
| `shadow-base` | `0 2px 8px 0 rgba(0, 0, 0, 0.4)` | **Default** - cards, panels |
| `shadow-md` | `0 4px 16px 0 rgba(0, 0, 0, 0.5)` | Dropdowns, popovers |
| `shadow-lg` | `0 8px 24px 0 rgba(0, 0, 0, 0.6)` | Modals, dialogs |
| `shadow-xl` | `0 16px 48px 0 rgba(0, 0, 0, 0.7)` | Important modals, maximum elevation |

### Semantic Glows

Special glows for graph nodes and emphasized states.

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-glow-blue` | `0 0 20px rgba(76, 141, 255, 0.3)` | Selected/active nodes |
| `shadow-glow-teal` | `0 0 20px rgba(46, 196, 182, 0.3)` | Verified nodes |
| `shadow-glow-amber` | `0 0 20px rgba(255, 184, 77, 0.3)` | Warning states |
| `shadow-glow-coral` | `0 0 20px rgba(242, 92, 84, 0.3)` | Error/contradiction states |

**Usage:** Apply glows to graph nodes in active/selected states to improve visual hierarchy.

---

## Interaction Tokens

### Transition Duration

| Token | Value | Usage |
|-------|-------|-------|
| `duration-instant` | `0ms` | No transition, immediate changes |
| `duration-fast` | `150ms` | Quick micro-interactions, hover states |
| `duration-base` | `250ms` | **Default** - most transitions |
| `duration-slow` | `400ms` | Emphasized transitions, panel slides |

**Default transition:**
```css
transition: all var(--duration-base) var(--ease);
```

### Easing Functions

| Token | Value | Usage |
|-------|-------|-------|
| `ease-linear` | `linear` | Progress bars, loading states |
| `ease` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | **Default** - smooth ease-in-out |
| `ease-in` | `cubic-bezier(0.4, 0.0, 1, 1)` | Acceleration (elements entering) |
| `ease-out` | `cubic-bezier(0.0, 0.0, 0.2, 1)` | Deceleration (elements exiting) |

### Opacity States

| Token | Value | Usage |
|-------|-------|-------|
| `opacity-disabled` | `0.4` | Disabled buttons, inactive controls |
| `opacity-dimmed` | `0.6` | Filtered-out nodes, background elements |
| `opacity-subtle` | `0.8` | Subtle emphasis, de-emphasized content |

---

## Focus States

Consistent focus indicators across all interactive elements.

| Token | Value | Usage |
|-------|-------|-------|
| `focus-ring-width` | `2px` | Width of focus indicator |
| `focus-ring-offset` | `2px` | Space between element and focus ring |
| `focus-ring-color` | `#4C8DFF` | Focus ring color (path-blue) |
| `focus-ring` | `0 0 0 2px rgba(76, 141, 255, 0.5)` | Complete focus ring shadow |

**Implementation:**
```css
.interactive:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

---

## Graph-Specific Tokens

### Node Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `node-size-sm` | `24px` | Dense graphs (100+ nodes) |
| `node-size-base` | `32px` | **Default** - standard graphs |
| `node-size-lg` | `48px` | Sparse graphs (< 20 nodes) |

### Node Border Width

| Token | Value | Usage |
|-------|-------|-------|
| `node-border-default` | `1px` | Default node border |
| `node-border-selected` | `2px` | Selected nodes |
| `node-border-emphasized` | `3px` | Very strong emphasis (rare) |

### Edge Stroke Width

| Token | Value | Usage |
|-------|-------|-------|
| `edge-stroke-light` | `1px` | Citation edges, weak connections |
| `edge-stroke-medium` | `2px` | **Default** - most edges |
| `edge-stroke-heavy` | `3px` | Strong relationships, contradictions |

### Edge Dash Patterns

| Token | Value | Usage |
|-------|-------|-------|
| `edge-dash-solid` | `0` | Strong, direct relationships |
| `edge-dash-dashed` | `4 4` | Inferred relationships, derived-from |
| `edge-dash-dotted` | `2 2` | Weak or tentative connections |

---

## Component Sizes

### Buttons

| Token | Value | Usage |
|-------|-------|-------|
| `button-height-sm` | `32px` | Compact UIs, inline actions |
| `button-height-md` | `40px` | **Default** button height |
| `button-height-lg` | `48px` | Primary CTAs, hero sections |
| `button-padding-sm` | `12px 16px` | Small button padding |
| `button-padding-md` | `12px 20px` | **Default** button padding |
| `button-padding-lg` | `14px 24px` | Large button padding |

### Inputs

| Token | Value | Usage |
|-------|-------|-------|
| `input-height-sm` | `32px` | Compact forms |
| `input-height-md` | `40px` | **Default** input height |
| `input-height-lg` | `48px` | Emphasized inputs |
| `input-padding-x` | `12px` | Horizontal padding for all inputs |

### Cards

| Token | Value | Usage |
|-------|-------|-------|
| `card-padding-sm` | `16px` | Compact cards |
| `card-padding-md` | `20px` | **Default** card padding |
| `card-padding-lg` | `24px` | Spacious cards |

### Modals

| Token | Value | Usage |
|-------|-------|-------|
| `modal-max-width-sm` | `400px` | Confirmation dialogs |
| `modal-max-width-md` | `600px` | **Default** modal width |
| `modal-max-width-lg` | `800px` | Forms, detailed content |
| `modal-max-width-xl` | `1200px` | Complex UIs, multi-column |

---

## Z-Index Scale

Consistent layering throughout the application.

| Token | Value | Layer |
|-------|-------|-------|
| `z-base` | `0` | Base content layer |
| `z-dropdown` | `1000` | Dropdowns, select menus |
| `z-sticky` | `1100` | Sticky headers, floating nav |
| `z-modal` | `1200` | Modal backgrounds, dialogs |
| `z-popover` | `1300` | Popovers, tooltips |
| `z-toast` | `1400` | Toast notifications (highest) |

---

## Implementation

### CSS Custom Properties

Import the CSS file in your application:

```css
@import './design-tokens.css';

/* Use tokens via var() */
.button {
  background-color: var(--path-blue);
  color: var(--paper);
  padding: var(--button-padding-md);
  border-radius: var(--radius-base);
  transition: all var(--duration-base) var(--ease);
}
```

### TypeScript

Import and use type-safe tokens:

```typescript
import { designTokens } from './design-tokens';

const primaryColor = designTokens.color.semantic.primary['path-blue'];
const defaultSpacing = designTokens.spacing[4];
```

### Tailwind CSS v4

Tokens are already configured in `/src/styles/theme.css` as CSS custom properties that Tailwind automatically picks up.

---

## Token Naming Convention

**Pattern:** `category-variant-state`

Examples:
- `path-blue` - semantic category, variant name
- `path-blue-hover` - semantic category, variant, state
- `space-4` - category, size
- `text-2xl` - category, size
- `shadow-glow-blue` - category, effect, variant

**Consistency:**
- Use kebab-case for all tokens
- Semantic colors use descriptive names (path-blue, signal-teal) not generic (primary, secondary)
- Sizes use numeric scales (1-20) or t-shirt sizes (sm, md, lg, xl)
- States use suffixes (-hover, -active, -disabled)

---

## Migration Notes

If updating from a previous version:

1. Replace hardcoded color values with token references
2. Update spacing to use the 4px-based scale
3. Apply consistent border radius across components
4. Use semantic colors instead of generic primary/secondary
5. Update shadows for dark-mode optimization

---

## Questions or Contributions

For questions about token usage or to propose new tokens, please reach out to the design system team.

**Last reviewed:** 2026-03-13  
**Version:** 1.0.0
