# Restormel Design System - Complete Specification

**Version:** 1.0.0  
**Last Updated:** 2026-03-13  
**Status:** Production Ready

---

## Table of Contents

1. [Introduction](#introduction)
2. [Design Principles](#design-principles)
3. [Quick Reference](#quick-reference)
4. [Foundation](#foundation)
5. [Components](#components)
6. [Graph Patterns](#graph-patterns)
7. [Page Layouts](#page-layouts)
8. [Usage Guidelines](#usage-guidelines)
9. [Implementation Guide](#implementation-guide)
10. [Accessibility](#accessibility)
11. [Resources](#resources)

---

## Introduction

### What is Restormel?

Restormel is a graph-native AI developer platform design system built for analyzing and visualizing reasoning workflows. Unlike generic AI startup aesthetics, Restormel prioritizes:

- **Technical credibility** over ornamental design
- **Analytical clarity** over visual flourish
- **Dark-mode workflows** for developer productivity
- **Graph-inspired patterns** that reflect data structures

### System Overview

This design system provides:

- **Design Tokens** - Foundational values (colors, spacing, typography)
- **Component Library** - 43 reusable UI components
- **Graph Patterns** - Specialized components for reasoning visualization
- **Page Templates** - Complete application layouts
- **Usage Guidelines** - Implementation best practices

### Who Should Use This?

- **Designers** - Creating interfaces for Restormel products
- **Engineers** - Implementing UI components
- **Product Managers** - Understanding design decisions
- **QA Engineers** - Testing against specifications

---

## Design Principles

### 1. Dark-Mode First

All colors, shadows, and contrast ratios optimized for dark backgrounds. Light mode is not supported—this is a deliberate choice for technical workflows.

**Rationale:** Developer tools are used in low-light environments. Dark interfaces reduce eye strain and improve focus during extended sessions.

### 2. Technical Credibility Over Ornament

No gradients, no drop shadows beyond functional elevation, no decorative elements. Every visual choice serves a functional purpose.

**Rationale:** Trust is built through restraint. Users should focus on the data, not the interface.

### 3. Calm, Analytical Interface

Subtle animations (150-250ms), muted color palette, generous whitespace. No "exciting" interactions or attention-grabbing effects.

**Rationale:** Reasoning analysis requires concentration. The interface should fade into the background.

### 4. Graph-Inspired Visual Language

Visual patterns echo graph structures: nodes, edges, hierarchies, paths, clusters. Color carries semantic meaning consistently.

**Rationale:** Visual metaphors that match mental models improve comprehension.

### 5. Semantic Color Meaning

Colors have consistent meanings across the entire system:

- **Blue** = Primary action, selected, query
- **Teal** = Verified, supported, evidence
- **Amber** = Unresolved, warning, synthesis
- **Coral** = Error, contradiction, conflict
- **Violet** = Inference, reasoning, AI-generated

**Rationale:** Consistent semantics build fluency. Users learn color meanings once and apply everywhere.

---

## Quick Reference

### Design Token Summary

| Category | Count | Example |
|----------|-------|---------|
| Colors | 65 | `--path-blue`, `--signal-teal` |
| Typography | 28 | `--text-base`, `--font-semibold` |
| Spacing | 12 | `--space-4` (16px) |
| Radius | 8 | `--radius-lg` (12px) |
| Shadows | 10 | `--shadow-md`, `--shadow-glow-blue` |
| Interaction | 11 | `--duration-base`, `--ease` |

**Full Reference:** See [DESIGN-TOKENS.md](./DESIGN-TOKENS.md)

### Component Summary

| Category | Count | Examples |
|----------|-------|----------|
| Atoms | 15 | Button, Input, Badge |
| Molecules | 11 | Card, Modal, Toast |
| Organisms | 4 | Navigation, Empty State |
| Graph Components | 13 | Node, Edge, Canvas, Inspector |
| Templates | 3 | Graph Kit App, Compare Mode |

**Full Reference:** See [COMPONENT-INVENTORY.md](./COMPONENT-INVENTORY.md)

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `path-blue` | #4C8DFF | Primary actions, selection, query nodes |
| `signal-teal` | #2EC4B6 | Verified, evidence, success |
| `amber-insight` | #FFB84D | Unresolved, warnings, synthesis |
| `coral-alert` | #F25C54 | Contradictions, errors |
| `violet-depth` | #9D84B7 | Inference, reasoning |
| `paper` | #E8EDF2 | Primary text |
| `mist` | #C4CFDB | Body text |
| `steel` | #8892A6 | Secondary text |
| `slate` | #2E3440 | Borders |
| `elevated` | #212830 | Raised surfaces |
| `charcoal` | #1A1F26 | Panels, cards |
| `ink` | #0F1419 | Background |

---

## Foundation

### Color System

#### Neutral Hierarchy

The neutral palette provides depth through subtle elevation:

```
Surface Elevation (bottom to top):
━━━━━━━━━━━━━━━━━━━━━━━━  ink (#0F1419)
    ┌──────────────┐         charcoal (#1A1F26)
    │  ┌────────┐  │         elevated (#212830)
    │  │        │  │
    └──┴────────┴──┘
```

**Usage:**
- `ink` - Page background, canvas
- `charcoal` - Primary panels, cards
- `elevated` - Modals, popovers, dropdown menus
- `slate` - Borders, dividers

#### Semantic Colors

Each semantic color has three states:

```
path-blue:        #4C8DFF  (default)
path-blue-hover:  #6BA3FF  (lighter)
path-blue-active: #3D7AE6  (darker)
```

**When to Use:**

**Path Blue** - Active interaction
- Primary buttons
- Selected items
- Active navigation
- Focus states
- Query nodes in graphs

**Signal Teal** - Verification and success
- Verified nodes
- Success messages
- Supported claims
- Evidence nodes
- Healthy states

**Amber Insight** - Attention needed
- Unresolved nodes
- Warning messages
- Pending validation
- Synthesis in progress
- Temporary states

**Coral Alert** - Problems and conflicts
- Error messages
- Contradiction nodes
- Failed validation
- Destructive actions
- Critical warnings

**Violet Depth** - AI reasoning
- Inference nodes
- Model-generated content
- Reasoning chains
- Logical connections
- Derived conclusions

#### Alpha Variants

Use alpha colors for backgrounds:

```css
/* Subtle tint (5%) */
background: var(--path-blue-5);

/* Standard background (10%) */
background: var(--path-blue-10);

/* Emphasized background (20%) */
background: var(--path-blue-20);
```

**Never** use alpha variants for text—readability suffers.

### Typography

#### Font Loading

```css
/* Required: Load these fonts first */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
```

#### Type Scale

```
H1: 48px / 3rem      (--text-5xl)  - Hero headings
H2: 36px / 2.25rem   (--text-4xl)  - Page headings
H3: 30px / 1.875rem  (--text-3xl)  - Section headings
H4: 24px / 1.5rem    (--text-2xl)  - Subsection headings
H5: 20px / 1.25rem   (--text-xl)   - Component headings

Body:   16px / 1rem     (--text-base)  - Default
Small:  14px / 0.875rem (--text-sm)    - Compact UI
Caption: 12px / 0.75rem (--text-xs)    - Metadata
```

#### Hierarchy Rules

```css
/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-weight: var(--font-semibold);  /* 600 */
  line-height: var(--leading-tight);   /* 1.25 */
  color: var(--paper);
}

/* Body text */
p, span, div {
  font-weight: var(--font-normal);    /* 400 */
  line-height: var(--leading-normal); /* 1.5 */
  color: var(--mist);
}

/* Labels */
label, .label {
  font-weight: var(--font-medium);    /* 500 */
  color: var(--mist);
}

/* Code, IDs, technical */
code, .mono {
  font-family: var(--font-mono);
  color: var(--mist);
}
```

### Spacing System

Based on 4px increments:

```
space-1:  4px   - Minimal gaps
space-2:  8px   - Tight spacing
space-3:  12px  - Small gaps
space-4:  16px  - Base unit (default)
space-5:  20px  - Medium gaps
space-6:  24px  - Card padding
space-8:  32px  - Large gaps
space-10: 40px  - Section spacing
space-12: 48px  - Major sections
space-16: 64px  - Page sections
space-20: 80px  - Hero spacing
```

#### Common Patterns

```css
/* Card padding */
padding: var(--space-6);  /* 24px */

/* Button padding */
padding: var(--space-3) var(--space-4);  /* 12px 16px */

/* Stack spacing (vertical) */
gap: var(--space-4);  /* 16px */

/* Inline spacing (horizontal) */
gap: var(--space-3);  /* 12px */

/* Section margin */
margin-bottom: var(--space-12);  /* 48px */
```

### Border Radius

Soft, rounded corners throughout:

```css
/* Small elements (badges, tags) */
border-radius: var(--radius-sm);    /* 4px */

/* Buttons, inputs */
border-radius: var(--radius-base);  /* 6px */

/* Cards, panels */
border-radius: var(--radius-lg);    /* 12px */

/* Modals, emphasized */
border-radius: var(--radius-xl);    /* 16px */

/* Pills, avatars */
border-radius: var(--radius-full);  /* 9999px */
```

**Never** use sharp corners (0px radius) except for technical elements like code blocks.

### Elevation (Shadows)

Shadows provide depth on dark backgrounds:

```css
/* Subtle hover */
box-shadow: var(--shadow-sm);

/* Default cards */
box-shadow: var(--shadow-base);

/* Dropdowns */
box-shadow: var(--shadow-md);

/* Modals */
box-shadow: var(--shadow-lg);

/* Selected graph nodes */
box-shadow: var(--shadow-glow-blue);
```

**Rule:** Stronger shadows (higher opacity) work better on dark backgrounds than light.

---

## Components

### Component Categories

#### Atoms (Basic Building Blocks)

**Buttons**
- 6 variants (primary, secondary, tertiary, outline, ghost, destructive)
- 3 sizes (sm: 32px, md: 40px, lg: 48px)
- Support icons, loading states, disabled states

**Inputs**
- Text, password, email, number, search, textarea
- 3 sizes
- Label, helper text, error states
- Leading/trailing icons

**Form Controls**
- Checkbox (checked, unchecked, indeterminate)
- Radio button
- Toggle switch
- Select dropdown

**Indicators**
- Badge (8 semantic variants)
- Spinner/Loader
- Status icons

#### Molecules (Composite Components)

**Card**
```
┌────────────────────────────┐
│ Title              [Action]│  ← Optional header
├────────────────────────────┤
│ Content area               │
│                            │
├────────────────────────────┤
│ Footer actions             │  ← Optional footer
└────────────────────────────┘
```

**Modal/Dialog**
```
Backdrop: rgba(0,0,0,0.7) + backdrop-blur

┌──────────────────────────┐
│ Title              [✕]   │
├──────────────────────────┤
│ Content                  │
├──────────────────────────┤
│        [Cancel] [Confirm]│
└──────────────────────────┘
```

**Toast Notification**
```
┌──────────────────────────┐
│ [Icon] Message      [✕] │  ← Auto-dismiss after 4s
└──────────────────────────┘
Position: top-right
```

#### Organisms (Complex Patterns)

**Navigation Bar**
- Logo + navigation items + user menu
- Sticky header (64px height)
- Dark background with bottom border

**Command Palette**
- Keyboard-triggered (⌘K / Ctrl+K)
- Fuzzy search
- Recent items
- Keyboard navigation

**Empty State**
- Icon + message + action
- Used when no data exists
- Helpful guidance text

### Component Usage Rules

#### When to Use What

**Buttons**
```
Primary:     Main CTA (one per screen/section)
Secondary:   Alternative actions
Tertiary:    Low-priority actions
Outline:     Equal-weight alternatives
Ghost:       Minimal emphasis, navigation
Destructive: Delete, remove, irreversible
```

**Badges**
```
category:           Generic labels
status-verified:    Success, completed, verified
status-warning:     Needs attention, pending
status-error:       Failed, error, blocked
confidence-high:    85-100% confidence
confidence-medium:  65-84% confidence
confidence-low:     <65% confidence
```

**Cards**
```
default:     Standard content container
elevated:    Emphasized or floating content
interactive: Clickable entire card
outlined:    Minimal emphasis, no bg
```

#### Composition Patterns

**Form Layout**
```tsx
<form>
  <Input 
    label="Node ID"
    placeholder="node-abc123"
    helperText="Unique identifier"
  />
  
  <Select
    label="Node Type"
    options={nodeTypes}
  />
  
  <div className="flex gap-3">
    <Button variant="primary">Save</Button>
    <Button variant="secondary">Cancel</Button>
  </div>
</form>
```

**Card with Actions**
```tsx
<Card>
  <CardHeader 
    title="Node Details"
    action={<IconButton icon={Close} />}
  />
  <CardContent>
    {/* Content */}
  </CardContent>
  <CardFooter>
    <Button variant="secondary">Export</Button>
  </CardFooter>
</Card>
```

---

## Graph Patterns

### Node Visualization

#### 8 Node Types

Each node type has:
- **Semantic color** from the system palette
- **Icon** representing its purpose
- **Border treatment** indicating state

| Type | Color | Icon | Usage |
|------|-------|------|-------|
| Query | path-blue | Terminal | User question, initial prompt |
| Evidence | signal-teal | FileText | Retrieved data, observations |
| Claim | amber-insight | Zap | Hypothesis requiring validation |
| Inference | violet-depth | GitBranch | Logical conclusion |
| Source | signal-teal | Database | Original data source |
| Synthesis | amber-insight | Box | Multi-source combination |
| Contradiction | coral-alert | X | Conflicting information |
| Conclusion | signal-teal | CheckCircle | Verified final output |

#### Node States

Visual treatments for different states:

```css
/* Default */
border: 1px solid var(--slate);
background: var(--charcoal);

/* Hovered */
border-color: var(--steel);
transform: scale(1.05);

/* Selected */
border: 2px solid var(--path-blue);
box-shadow: var(--shadow-glow-blue);

/* Verified */
border: 2px solid var(--signal-teal);
background: var(--signal-teal-10);

/* Unresolved */
border: 2px solid var(--amber-insight);
background: var(--amber-insight-10);

/* Contradicted */
border: 2px solid var(--coral-alert);
background: var(--coral-alert-10);

/* Dimmed (filtered out) */
opacity: 0.4;
```

#### Node Sizing

Adapt node size to graph density:

```
Dense graph (100+ nodes):  24×24px  (--node-size-sm)
Standard graph (20-100):   32×32px  (--node-size-base)
Sparse graph (<20 nodes):  48×48px  (--node-size-lg)
```

### Edge Visualization

#### 7 Edge Types

| Type | Color | Width | Style | Meaning |
|------|-------|-------|-------|---------|
| supports | signal-teal | 2px | solid | Evidence validates claim |
| contradicts | coral-alert | 2px | solid | Evidence refutes claim |
| derived-from | violet-depth | 2px | dashed | Logical inference |
| cites | steel | 1px | solid | Reference to source |
| retrieved-from | path-blue | 1px | solid | Data from source |
| inferred-by | violet-depth | 2px | dashed | Model reasoning |
| unresolved | amber-insight | 1px | dashed | Needs validation |

#### Edge States

```css
/* Default */
stroke: var(--edge-color);
stroke-width: var(--edge-width);
opacity: 0.8;

/* Hovered */
opacity: 1;
stroke-width: calc(var(--edge-width) + 1px);

/* Selected path */
opacity: 1;
stroke-width: calc(var(--edge-width) + 1px);
filter: drop-shadow(0 0 8px var(--edge-color));

/* Dimmed */
opacity: 0.3;
```

### Graph Canvas

#### Layout Principles

1. **Auto-layout first** - Force-directed for most graphs
2. **Hierarchical for traces** - Timeline-based for sequential reasoning
3. **Manual override** - Allow user positioning when needed

#### Interaction Patterns

```
Pan:           Drag canvas background
Zoom:          Scroll wheel
Select:        Click node
Multi-select:  Cmd/Ctrl + Click
Marquee:       Shift + Drag
Deselect:      Click background
```

#### Canvas Controls

Position controls as overlay:

```
Top-left:     Zoom controls, layout selector
Top-right:    Layer filters, view modes
Bottom-left:  Minimap (optional)
Bottom-right: Legend (optional)
```

### Inspector Panel

Complete node information display:

```
┌────────────────────────────┐
│ [Icon] Node Label    [✕]  │  ← Header (dismissible)
├────────────────────────────┤
│ node-id-abc123             │  ← ID (monospace)
│                            │
│ Type: Evidence             │
│ Status: Verified ✓         │
│ Confidence: 94%            │
│ Created: 10:29:15          │
├────────────────────────────┤
│ Description                │  ← Full content
│ Retrieved database query   │
│ logs showing timeout...    │
├────────────────────────────┤
│ Connections (5)       [⌄] │  ← Collapsible
│  → Supports: claim-7f3    │
│  → Derived: inference-4a2  │
├────────────────────────────┤
│ Evidence (3)          [⌄] │
│  • Database logs           │
│  • Config analysis         │
├────────────────────────────┤
│ Provenance                 │
│  Source: gpt-4-turbo       │
│  Confidence: 0.94          │
│  Timestamp: 10:29:15.240   │
└────────────────────────────┘
```

### Timeline Playback

Temporal visualization of graph evolution:

```
┌────────────────────────────────────┐
│ [⟲] [◀] [▶] [▶▶]  1x    Step 5/12 │  ← Controls
├────────────────────────────────────┤
│ ●───●───●───●───●───●───●──────●  │  ← Progress
│         Past    ↑      Future      │
│              Current               │
├────────────────────────────────────┤
│ [Icon] Evidence added              │  ← Event details
│ Retrieved query logs               │
│ +2.5s from start                   │
└────────────────────────────────────┘
```

**Playback behaviors:**
- Nodes appear when created
- Edges draw when relationships form
- States update (verified, contradicted)
- Current node highlighted

**Controls:**
- Play/Pause toggle
- Step forward/backward
- Speed: 0.5x, 1x, 1.5x, 2x, 4x
- Jump to event (click timeline)

### Compare Mode

Side-by-side or unified diff views:

**Side-by-side Layout:**
```
┌────────────┬────────────┐
│ Before     │ After      │
│            │            │
│ Graph A    │ Graph B    │
│            │            │
└────────────┴────────────┘
```

**Change Indicators:**
```
+ Added nodes:    teal border, teal/10 background
- Removed nodes:  coral border, coral/10 background, dashed
~ Modified nodes: amber border, amber/10 background
```

**Diff Summary:**
```
Added: 12 nodes
Removed: 4 nodes
Modified: 8 nodes
Unchanged: 34 nodes (hidden by default)
```

---

## Page Layouts

### Graph Kit Application

Full-screen graph analysis interface:

```
┌──────────────────────────────────────┐
│ Navigation (64px)                    │
├──────────────────────────────────────┤
│ Control Bar (56px)                   │  ← Filters, view modes
├──────┬─────────────────────┬─────────┤
│      │                     │         │
│ Side │   Graph Canvas      │ Insp-   │
│ bar  │                     │ ector   │
│      │                     │         │
│ 240px│     (flexible)      │ 320px   │
├──────┴─────────────────────┴─────────┤
│ Timeline (200px)                     │
└──────────────────────────────────────┘
```

**Responsive behavior:**
- Sidebar collapses to icons (<1280px)
- Inspector panel overlays on mobile (<768px)
- Timeline becomes collapsible drawer (<1024px)

### Documentation Page

Clean reading experience:

```
┌──────────────────────────────────────┐
│ Navigation (64px)                    │
├──────┬───────────────────────────────┤
│      │                               │
│ Docs │   Content Area                │
│ Nav  │   (max-width: 800px)          │
│      │                               │
│ 240px│   Centered, readable width    │
│      │                               │
└──────┴───────────────────────────────┘
```

---

## Usage Guidelines

### Color Usage

#### Do's ✅

- Use semantic colors consistently (blue = selection, teal = verified)
- Use alpha variants for backgrounds, never for text
- Maintain WCAG AA contrast (4.5:1 minimum for text)
- Use neutral palette for non-semantic elements

#### Don'ts ❌

- Don't use colors outside the defined palette
- Don't rely solely on color to convey meaning
- Don't use semantic colors for decoration
- Don't mix light and dark mode colors

### Typography

#### Do's ✅

- Use Inter for UI text, IBM Plex Mono for code
- Stick to the type scale (don't create arbitrary sizes)
- Use semibold (600) for headings
- Use proper line-height (1.5 for body, 1.25 for headings)

#### Don'ts ❌

- Don't use more than 3 weights per screen
- Don't use font sizes below 12px
- Don't use italic for emphasis (use semibold)
- Don't use all-caps for long text

### Spacing

#### Do's ✅

- Use the 4px-based spacing scale
- Be consistent with padding (space-6 for cards)
- Use larger gaps between sections than within
- Align elements to the spacing grid

#### Don'ts ❌

- Don't use arbitrary spacing values
- Don't use unequal padding (keep symmetrical)
- Don't pack elements too tightly (<8px gaps)
- Don't over-space (creates disconnect)

### Interaction

#### Do's ✅

- Provide visual feedback for all interactions
- Use consistent transition duration (250ms default)
- Show loading states for async operations
- Disable rather than hide unavailable actions

#### Don'ts ❌

- Don't use slow transitions (>400ms feels sluggish)
- Don't animate everything (use purposefully)
- Don't hide functionality without explanation
- Don't use hover-only critical features (mobile)

---

## Implementation Guide

### Getting Started

#### 1. Install Dependencies

```bash
npm install lucide-react
```

Fonts are loaded via CSS (see design-tokens.css).

#### 2. Import Token System

```tsx
// Import CSS tokens
import './design-tokens.css';

// Or import TypeScript tokens
import { designTokens } from './design-tokens';
```

#### 3. Use in Components

```tsx
// CSS approach
<div className="bg-charcoal border border-slate rounded-lg p-6">
  <h2 className="text-paper font-semibold">Heading</h2>
  <p className="text-mist">Body text</p>
</div>

// Or with CSS variables
<div style={{
  backgroundColor: 'var(--charcoal)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)'
}}>
```

### Building Components

#### Component Template

```tsx
import React from 'react';
import { cn } from '@/lib/utils';

interface ComponentProps {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children: React.ReactNode;
}

export function Component({
  variant = 'primary',
  size = 'md',
  disabled = false,
  children
}: ComponentProps) {
  return (
    <div
      className={cn(
        // Base styles
        "rounded-lg transition-all",
        
        // Variants
        variant === 'primary' && "bg-path-blue text-paper",
        variant === 'secondary' && "bg-elevated border border-slate",
        
        // Sizes
        size === 'sm' && "p-2 text-sm",
        size === 'md' && "p-4 text-base",
        size === 'lg' && "p-6 text-lg",
        
        // States
        disabled && "opacity-disabled pointer-events-none"
      )}
    >
      {children}
    </div>
  );
}
```

#### Utility Function (cn)

```tsx
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Graph Implementation

#### Node Component

```tsx
interface GraphNodeProps {
  id: string;
  type: NodeType;
  label: string;
  status: 'verified' | 'unresolved' | 'contradicted';
  selected?: boolean;
  onSelect?: () => void;
}

export function GraphNode({
  id,
  type,
  label,
  status,
  selected,
  onSelect
}: GraphNodeProps) {
  const nodeConfig = getNodeConfig(type);
  
  return (
    <div
      className={cn(
        "rounded-md border-2 p-3 cursor-pointer transition-all",
        "hover:scale-105 hover:border-steel",
        selected && "border-path-blue shadow-glow-blue",
        status === 'verified' && "border-signal-teal bg-signal-teal-10",
        status === 'unresolved' && "border-amber-insight bg-amber-insight-10",
        status === 'contradicted' && "border-coral-alert bg-coral-alert-10"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <nodeConfig.icon className={cn("h-4 w-4", nodeConfig.colorClass)} />
        <span className="text-xs font-mono text-steel">{id}</span>
      </div>
      <div className="text-sm text-paper mt-2">{label}</div>
    </div>
  );
}
```

---

## Accessibility

### WCAG Compliance

Target: **WCAG 2.1 Level AA**

#### Color Contrast

All text meets minimum contrast:

| Text Type | Minimum Ratio | Our Values |
|-----------|---------------|------------|
| Normal text | 4.5:1 | 7.2:1 (paper on ink) |
| Large text | 3:1 | 5.8:1 (mist on charcoal) |
| UI components | 3:1 | 4.8:1 (steel on elevated) |

#### Keyboard Navigation

All interactive elements must be:
- Reachable via Tab key
- Activatable via Enter or Space
- Have visible focus indicators
- Follow logical tab order

```css
/* Focus indicator (required) */
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

#### Screen Reader Support

Use semantic HTML and ARIA when needed:

```tsx
// Good: Semantic HTML
<button onClick={handleClick}>Submit</button>

// Good: ARIA label for icon buttons
<button aria-label="Close modal" onClick={onClose}>
  <X className="h-4 w-4" />
</button>

// Good: Live region for notifications
<div role="status" aria-live="polite">
  {notification}
</div>
```

#### Motion & Animation

Respect user preferences:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Resources

### Documentation Files

- **[Design Tokens](./design-tokens.json)** - Complete token definitions (JSON)
- **[Design Tokens (TS)](./design-tokens.ts)** - TypeScript implementation
- **[Design Tokens (CSS)](./design-tokens.css)** - CSS custom properties
- **[Design Tokens Documentation](./DESIGN-TOKENS.md)** - Complete token reference
- **[Component Inventory](./COMPONENT-INVENTORY.md)** - All components documented
- **[This Specification](./DESIGN-SPECIFICATION.md)** - You are here

### Design Assets

- Figma library (coming soon)
- Icon set: [Lucide Icons](https://lucide.dev)
- Font: [Inter](https://fonts.google.com/specimen/Inter)
- Mono font: [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono)

### Code Examples

See the implementation in `/src/app/` for reference:
- Button: `/src/app/components/ui/Button.tsx`
- Badge: `/src/app/components/ui/Badge.tsx`
- Graph patterns: `/src/app/pages/GraphKitDocs.tsx`

### Tools

- **Tailwind CSS v4** - Utility framework
- **Lucide React** - Icon components
- **React Router** - Navigation
- **TypeScript** - Type safety

---

## Contributing

### Proposing Changes

To propose new tokens, components, or patterns:

1. Review existing system for similar solutions
2. Document the use case and rationale
3. Provide examples and edge cases
4. Submit for design review
5. Update this specification

### Design Review Checklist

- [ ] Follows design principles
- [ ] Uses existing tokens (no new colors/spacing)
- [ ] Accessible (WCAG AA minimum)
- [ ] Responsive design considered
- [ ] Dark mode optimized
- [ ] Documentation complete
- [ ] Examples provided
- [ ] Edge cases addressed

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-13 | Initial comprehensive specification |

---

## Questions?

For design system questions or proposals, contact the Restormel design team.

**Maintained by:** Restormel Design System Team  
**Last Review:** 2026-03-13  
**Next Review:** 2026-06-13
