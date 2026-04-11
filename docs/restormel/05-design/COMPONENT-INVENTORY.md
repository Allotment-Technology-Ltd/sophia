# Restormel Design System - Component Inventory

**Version:** 1.0.0  
**Last Updated:** 2026-03-13

## Overview

Complete inventory of all components in the Restormel graph-native AI developer platform design system. Components are organized using Atomic Design methodology.

**Component Maturity Levels:**
- 🟢 **Production Ready** - Fully implemented and tested
- 🟡 **In Development** - Partially implemented
- 🔵 **Specified** - Design complete, awaiting implementation

---

## Table of Contents

1. [Foundation Elements (Atoms)](#foundation-elements-atoms)
2. [Composite Components (Molecules)](#composite-components-molecules)
3. [Pattern Components (Organisms)](#pattern-components-organisms)
4. [Graph-Specific Components](#graph-specific-components)
5. [Page Templates](#page-templates)

---

## Foundation Elements (Atoms)

### Button 🟢

**Purpose:** Primary interactive element for user actions

#### Variants

| Variant | Use Case | Visual Treatment |
|---------|----------|------------------|
| `primary` | Main call-to-action | `bg-path-blue`, white text, solid fill |
| `secondary` | Secondary actions | `bg-elevated`, `border-slate`, mist text |
| `tertiary` | Subtle actions | Transparent bg, mist text, no border |
| `outline` | Alternative emphasis | Transparent bg, `border-path-blue`, blue text |
| `ghost` | Minimal emphasis | Transparent bg, steel text, hover only |
| `destructive` | Dangerous actions | `bg-coral-alert`, white text |

#### Sizes

| Size | Height | Padding | Font Size | Icon Size |
|------|--------|---------|-----------|-----------|
| `sm` | 32px | 12px 16px | 0.875rem (14px) | 16px |
| `md` | 40px | 12px 20px | 0.875rem (14px) | 16px |
| `lg` | 48px | 14px 24px | 1rem (16px) | 20px |

#### States

| State | Visual Change |
|-------|---------------|
| Default | Base styling |
| Hover | Brightness +10%, subtle lift |
| Active | Brightness -10% |
| Focus | `focus-ring` shadow |
| Disabled | `opacity-disabled` (0.4), no pointer events |
| Loading | Spinner icon, disabled state |

#### Anatomy

```
┌─────────────────────────────┐
│  [Icon] Label Text  [Icon]  │  ← Optional leading/trailing icons
└─────────────────────────────┘
     ↑           ↑
  Gap: 8px   Text (semibold)
```

#### Props

- `variant`: Determines visual style
- `size`: Controls height and padding
- `disabled`: Disables interaction
- `loading`: Shows loading spinner
- `icon`: Optional icon component
- `iconPosition`: `leading` | `trailing`
- `fullWidth`: Expands to container width

---

### Input 🟢

**Purpose:** Text entry and form data collection

#### Variants

| Variant | Use Case |
|---------|----------|
| `text` | Single-line text |
| `password` | Obscured text |
| `email` | Email validation |
| `number` | Numeric input |
| `search` | Search queries with icon |
| `textarea` | Multi-line text |

#### Sizes

| Size | Height | Padding | Font Size |
|------|--------|---------|-----------|
| `sm` | 32px | 12px | 0.875rem (14px) |
| `md` | 40px | 12px | 0.875rem (14px) |
| `lg` | 48px | 16px | 1rem (16px) |

#### States

| State | Visual Treatment |
|-------|------------------|
| Default | `bg-elevated`, `border-slate` |
| Hover | `border-steel` |
| Focus | `border-path-blue` (2px), `focus-ring` |
| Error | `border-coral-alert` (2px), error message below |
| Disabled | `opacity-disabled`, no interaction |
| Read-only | `bg-charcoal`, `border-slate`, muted text |

#### Anatomy

```
┌─────────────────────────────────────┐
│ [Icon] Placeholder or text value    │  ← Optional leading icon
│                               [Icon] │  ← Optional trailing icon (clear, validation)
└─────────────────────────────────────┘
  Label (above) ↑
  Helper text or error (below) ↓
```

#### Props

- `label`: Field label (above input)
- `placeholder`: Placeholder text
- `helperText`: Guidance text below
- `error`: Error message (replaces helper text)
- `disabled`: Disables input
- `readOnly`: Prevents editing
- `leadingIcon`: Icon before text
- `trailingIcon`: Icon after text

---

### Badge 🟢

**Purpose:** Status indicators, labels, and metadata chips

#### Variants

| Variant | Color | Use Case |
|---------|-------|----------|
| `category` | Path blue | General categorization |
| `category-muted` | Steel | De-emphasized categories |
| `status-verified` | Signal teal | Verified/success states |
| `status-warning` | Amber insight | Warning/unresolved |
| `status-error` | Coral alert | Error/contradiction |
| `confidence-high` | Signal teal | Confidence > 85% |
| `confidence-medium` | Amber insight | Confidence 65-85% |
| `confidence-low` | Coral alert | Confidence < 65% |

#### Sizes

| Size | Padding | Font Size |
|------|---------|-----------|
| Default | 4px 8px | 0.75rem (12px) |
| Small | 2px 6px | 0.625rem (10px) |

#### Anatomy

```
┌──────────────────┐
│ [Icon] Label     │  ← Optional icon (4px gap)
└──────────────────┘
  Rounded (full), uppercase/small-caps
```

#### Props

- `variant`: Determines color and semantics
- `icon`: Optional leading icon
- `size`: Control size variant

---

### Icon Button 🟢

**Purpose:** Icon-only actions (no text label)

#### Variants

Same as Button variants but icon-only

#### Sizes

| Size | Dimensions | Icon Size |
|------|------------|-----------|
| `sm` | 32×32px | 16px |
| `md` | 40×40px | 20px |
| `lg` | 48×48px | 24px |

#### Anatomy

```
┌─────┐
│  ⚙  │  ← Icon centered, equal padding all sides
└─────┘
```

#### Accessibility

- Always include `aria-label` for screen readers
- Show tooltip on hover (optional)

---

### Checkbox 🟢

**Purpose:** Binary selection (on/off)

#### States

| State | Visual |
|-------|--------|
| Unchecked | Empty box, `border-slate` |
| Checked | `bg-path-blue`, white checkmark |
| Indeterminate | `bg-path-blue`, white dash |
| Disabled | `opacity-disabled` |
| Error | `border-coral-alert` |

#### Anatomy

```
┌───┐
│ ✓ │  Label text
└───┘
16×16px box, 2px border, 6px radius
```

---

### Radio Button 🟢

**Purpose:** Single selection from multiple options

#### States

| State | Visual |
|-------|--------|
| Unselected | Empty circle, `border-slate` |
| Selected | `border-path-blue` (2px), inner dot |
| Disabled | `opacity-disabled` |

#### Anatomy

```
  ●  Label text
16×16px circle, inner dot 8×8px
```

---

### Toggle Switch 🟢

**Purpose:** On/off state toggle (like checkbox but more prominent)

#### States

| State | Visual |
|-------|--------|
| Off | `bg-slate`, handle left |
| On | `bg-path-blue`, handle right |
| Disabled | `opacity-disabled` |

#### Anatomy

```
Off:  [○────]
On:   [────○]
40×24px track, 20×20px handle
```

---

### Select / Dropdown 🟢

**Purpose:** Choose from a list of options

#### States

| State | Visual |
|-------|--------|
| Closed | Input-like, chevron icon |
| Open | Popover menu below |
| Selected | Value shown in field |
| Disabled | `opacity-disabled` |

#### Anatomy

```
Trigger:
┌─────────────────────────┐
│ Selected value       ⌄  │
└─────────────────────────┘

Menu (when open):
┌─────────────────────────┐
│ Option 1          [✓]   │  ← Active option
│ Option 2                │
│ Option 3                │
└─────────────────────────┘
```

---

### Tooltip 🟢

**Purpose:** Contextual help on hover

#### Variants

| Variant | Use Case |
|---------|----------|
| Default | General help text |
| Error | Error explanations |
| Info | Additional information |

#### Anatomy

```
     [Trigger element]
          ▼
    ┌──────────┐
    │ Tooltip  │
    │  text    │
    └──────────┘
8px arrow, max-width 240px
```

#### Behavior

- Appears on hover (100ms delay)
- Disappears on mouse leave
- Auto-positions to avoid viewport edges

---

### Spinner / Loader 🟢

**Purpose:** Loading state indication

#### Variants

| Variant | Size | Use Case |
|---------|------|----------|
| `sm` | 16px | Inline loading |
| `md` | 24px | Button loading |
| `lg` | 48px | Page loading |

#### Anatomy

```
  ○  ← Spinning circle
Path blue by default, inherits color
```

---

### Divider 🟢

**Purpose:** Visual separation between sections

#### Variants

| Variant | Visual |
|---------|--------|
| Horizontal | 1px height, full width |
| Vertical | 1px width, full height |

#### Color

- Default: `border-slate`
- Can use semantic colors for emphasis

---

### Avatar 🟢

**Purpose:** User representation

#### Sizes

| Size | Dimensions |
|------|------------|
| `sm` | 32px |
| `md` | 40px |
| `lg` | 48px |
| `xl` | 64px |

#### Anatomy

```
  ┌───┐
  │ AB │  ← Initials or image
  └───┘
Fully rounded (radius-full)
```

---

## Composite Components (Molecules)

### Card 🟢

**Purpose:** Container for related content

#### Variants

| Variant | Visual Treatment |
|---------|------------------|
| `default` | `bg-charcoal`, `border-slate`, subtle shadow |
| `elevated` | `bg-elevated`, larger shadow |
| `interactive` | Hover state, clickable |
| `outlined` | No background, just border |

#### Anatomy

```
┌─────────────────────────────────┐
│ Header (optional)               │  ← Title, actions
├─────────────────────────────────┤
│                                 │
│ Content area                    │
│                                 │
├─────────────────────────────────┤
│ Footer (optional)               │  ← Actions, metadata
└─────────────────────────────────┘

Padding: space-6 (24px)
Border radius: radius-lg (12px)
```

#### Props

- `title`: Card title
- `actions`: Header actions
- `footer`: Footer content
- `interactive`: Makes card clickable
- `elevation`: Shadow level

---

### Modal / Dialog 🟢

**Purpose:** Focused interaction requiring user response

#### Sizes

| Size | Max Width |
|------|-----------|
| `sm` | 400px |
| `md` | 600px |
| `lg` | 800px |
| `xl` | 1200px |

#### Anatomy

```
┌──────────────────────────────────────┐
│ Title                           [✕]  │  ← Header with close
├──────────────────────────────────────┤
│                                      │
│ Content area                         │
│                                      │
├──────────────────────────────────────┤
│                  [Cancel] [Confirm]  │  ← Footer with actions
└──────────────────────────────────────┘

Overlay: backdrop-blur, rgba(0,0,0,0.7)
Shadow: shadow-xl
Border radius: radius-xl (16px)
```

#### Behavior

- Traps focus within modal
- Closes on ESC key or backdrop click (optional)
- Disables body scroll
- Animates in/out

---

### Toast Notification 🟢

**Purpose:** Temporary feedback messages

#### Variants

| Variant | Color | Icon | Use Case |
|---------|-------|------|----------|
| `success` | Signal teal | CheckCircle | Success confirmation |
| `error` | Coral alert | X | Error messages |
| `warning` | Amber insight | AlertTriangle | Warnings |
| `info` | Path blue | Info | Information |

#### Anatomy

```
┌──────────────────────────────────┐
│ [Icon] Message text         [✕] │
└──────────────────────────────────┘

Position: top-right corner
Auto-dismiss: 4s (configurable)
```

---

### Search Input 🟢

**Purpose:** Search with autocomplete and filtering

#### Anatomy

```
┌─────────────────────────────────┐
│ 🔍 Search...              [✕]   │  ← Clear button when typing
└─────────────────────────────────┘
     ↓ (when typing)
┌─────────────────────────────────┐
│ Result 1                        │
│ Result 2                        │
│ Result 3                        │
└─────────────────────────────────┘
```

#### Features

- Leading search icon
- Trailing clear button
- Dropdown results
- Keyboard navigation
- Debounced search

---

### Filter Panel 🟢

**Purpose:** Multi-criteria filtering interface

#### Anatomy

```
┌────────────────────────────┐
│ Filters            [Reset] │
├────────────────────────────┤
│ Category 1                 │
│  ☑ Option A (12)          │
│  ☐ Option B (8)           │
│                            │
│ Category 2                 │
│  ☑ Option C (5)           │
│  ☐ Option D (3)           │
├────────────────────────────┤
│ [Apply Filters]            │
└────────────────────────────┘
```

#### Features

- Grouped filters
- Count badges
- Reset button
- Apply button (optional)
- Collapsible sections

---

### Data Table 🟢

**Purpose:** Structured data display with sorting and actions

#### Anatomy

```
┌────────────────────────────────────────────┐
│ Column 1 ↕  │ Column 2 ↕  │ Actions       │  ← Header (sortable)
├─────────────┼─────────────┼───────────────┤
│ Data        │ Data        │ [Edit] [Del]  │
│ Data        │ Data        │ [Edit] [Del]  │
│ Data        │ Data        │ [Edit] [Del]  │
└────────────────────────────────────────────┘
```

#### Features

- Sortable columns
- Row selection (checkboxes)
- Inline actions
- Pagination
- Empty states

---

### Breadcrumb 🟢

**Purpose:** Navigation hierarchy display

#### Anatomy

```
Home  >  Products  >  Graph Kit  >  Current Page
 ↑        ↑            ↑              ↑
Link    Link        Link        Text (current)
```

---

### Tabs 🟢

**Purpose:** Content organization with switchable views

#### Variants

| Variant | Visual |
|---------|--------|
| `line` | Underline indicator |
| `pill` | Rounded background |
| `segment` | Segmented control |

#### Anatomy

```
Line variant:
─────────────────────────────
  Tab 1    Tab 2    Tab 3
  ────
Active underline (2px path-blue)

Content panel below
```

---

### Accordion 🟢

**Purpose:** Collapsible content sections

#### Anatomy

```
┌──────────────────────────────┐
│ Section 1              [⌄]  │  ← Collapsed
├──────────────────────────────┤
│ Section 2              [⌃]  │  ← Expanded
│                              │
│ Content shown here...        │
│                              │
├──────────────────────────────┤
│ Section 3              [⌄]  │  ← Collapsed
└──────────────────────────────┘
```

---

### Pagination 🟢

**Purpose:** Navigate through paged content

#### Anatomy

```
[◀ Prev]  1  2  [3]  4  5  [Next ▶]
           ↑     ↑
        Link  Current (highlighted)

Showing 21-30 of 127 results
```

---

## Pattern Components (Organisms)

### Navigation Bar 🟢

**Purpose:** Primary application navigation

#### Anatomy

```
┌──────────────────────────────────────────────┐
│ [Logo] Nav Item  Nav Item  Nav Item  [User] │
└──────────────────────────────────────────────┘

Sticky: yes
Height: 64px
Background: charcoal
Border bottom: 1px slate
```

---

### Sidebar Navigation 🟢

**Purpose:** Secondary navigation, filters, or tools

#### Anatomy

```
┌──────────────┐
│ Section 1    │
│  ▸ Item      │
│  ▾ Item      │
│    - Sub     │
│    - Sub     │
│              │
│ Section 2    │
│  ▸ Item      │
└──────────────┘

Width: 240-280px
Collapsible: yes
```

---

### Command Palette 🟢

**Purpose:** Keyboard-driven command interface

#### Anatomy

```
┌────────────────────────────────┐
│ 🔍 Search commands...          │
├────────────────────────────────┤
│ ⌘ Create New Trace             │
│ ⌘ Open Graph Inspector         │
│ ⌘ Compare Runs                 │
└────────────────────────────────┘

Triggered: Cmd+K / Ctrl+K
Position: Center screen
Max height: 400px
```

---

### Empty State 🟢

**Purpose:** Guidance when no content exists

#### Anatomy

```
        ┌──────┐
        │ Icon │
        └──────┘
    
    Primary message
    
    Secondary explanation
    or helpful guidance
    
    [Primary Action]
```

#### Variants

- No data loaded
- No search results
- Empty collection
- Error state

---

### Loading State 🟢

**Purpose:** Content loading indicators

#### Variants

| Variant | Use Case |
|---------|----------|
| Skeleton | Content preview while loading |
| Spinner | Indeterminate loading |
| Progress bar | Determinate loading |

#### Anatomy (Skeleton)

```
┌────────────────────────┐
│ ▓▓▓▓▓▓▓▓               │  ← Gray bars
│ ▓▓▓▓▓▓▓▓▓▓▓            │     animating
│ ▓▓▓▓▓                  │     shimmer
└────────────────────────┘
```

---

## Graph-Specific Components

### Graph Node 🟢

**Purpose:** Visual representation of reasoning elements

#### Node Types (8 variants)

Each type has distinct icon and color:

| Type | Color | Icon | Border Width |
|------|-------|------|--------------|
| Query | Path blue | Terminal | 2px |
| Evidence | Signal teal | FileText | 1px |
| Claim | Amber insight | Zap | 2px |
| Inference | Violet depth | GitBranch | 1px |
| Source | Signal teal | Database | 1px |
| Synthesis | Amber insight | Box | 2px |
| Contradiction | Coral alert | X | 2px |
| Conclusion | Signal teal | CheckCircle | 2px |

#### States

| State | Visual Treatment |
|-------|------------------|
| Default | Type color, base size |
| Hovered | Border steel, slight scale |
| Selected | Border 2px, glow shadow |
| Related | Border 50% opacity, subtle background |
| Verified | Border signal-teal, checkmark badge |
| Unresolved | Border amber-insight, warning badge |
| Contradicted | Border coral-alert, X badge |
| Dimmed | Opacity 40%, muted colors |

#### Sizes

| Size | Dimensions | Use Case |
|------|------------|----------|
| `sm` | 24×24px | Dense graphs (100+ nodes) |
| `base` | 32×32px | Standard graphs |
| `lg` | 48×48px | Sparse graphs (<20 nodes) |
| `card` | Variable | Expanded card view |

#### Anatomy

```
Card view:
┌────────────────────────────┐
│ [Icon] node-id             │  ← Header
├────────────────────────────┤
│ Label text / description   │  ← Content
├────────────────────────────┤
│ [Badge] [Badge]            │  ← Metadata
└────────────────────────────┘

Compact view:
  ┌──┐
  │▣ │  ← Icon only
  └──┘
```

#### Props

- `type`: Node type (query, evidence, etc.)
- `id`: Unique identifier
- `label`: Display text
- `status`: Verified/unresolved/contradicted
- `confidence`: Confidence score (0-1)
- `selected`: Selection state
- `dimmed`: Dimmed state for filtering

---

### Graph Edge 🟢

**Purpose:** Visual relationship between nodes

#### Edge Types (7 variants)

| Type | Color | Stroke Width | Style | Marker |
|------|-------|--------------|-------|--------|
| Supports | Signal teal | 2px | Solid | Arrow |
| Contradicts | Coral alert | 2px | Solid | Arrow |
| Derived-from | Violet depth | 2px | Dashed | Arrow |
| Cites | Steel | 1px | Solid | Arrow |
| Retrieved-from | Path blue | 1px | Solid | Arrow |
| Inferred-by | Violet depth | 2px | Dashed | Arrow |
| Unresolved | Amber insight | 1px | Dashed | Arrow |

#### States

| State | Visual |
|-------|--------|
| Default | Type styling |
| Hovered | Increased opacity, label shown |
| Selected | Glow shadow, emphasized |
| Dimmed | Opacity 30% |

#### Anatomy

```
node-1 ────────→ node-2
         ↑
      Edge label
     (on hover)
```

#### Props

- `type`: Edge type
- `from`: Source node ID
- `to`: Target node ID
- `label`: Optional label text
- `weight`: Visual weight (light/medium/heavy)

---

### Graph Canvas 🟢

**Purpose:** Container for graph visualization

#### Anatomy

```
┌────────────────────────────────────────┐
│ [Controls]                    [Layers] │  ← Overlay controls
│                                        │
│          Graph visualization           │
│          (nodes + edges)               │
│                                        │
│ [Minimap]                    [Legend]  │  ← Overlay info
└────────────────────────────────────────┘
```

#### Features

- Pan and zoom
- Auto-layout
- Minimap navigation
- Layer filtering
- Grid background (optional)
- Selection marquee

#### Controls

| Control | Action |
|---------|--------|
| Drag canvas | Pan view |
| Scroll | Zoom in/out |
| Click node | Select |
| Cmd+Click | Multi-select |
| Shift+Drag | Marquee select |

---

### Graph Inspector Panel 🟢

**Purpose:** Detailed node information display

#### Anatomy

```
┌────────────────────────────────┐
│ [Icon] Node Label         [✕] │  ← Header
├────────────────────────────────┤
│ node-id-abc123                 │  ← ID (monospace)
│                                │
│ Status: Verified ✓             │
│ Confidence: 94%                │
│ Created: 10:29:15              │
├────────────────────────────────┤
│ Description                    │  ← Content
│ Full text content...           │
├────────────────────────────────┤
│ Evidence (3)              [⌄] │  ← Collapsible sections
│  • Evidence 1                  │
│  • Evidence 2                  │
│  • Evidence 3                  │
├────────────────────────────────┤
│ Provenance                     │
│  Source: gpt-4-turbo           │
│  Timestamp: 10:29:15.240       │
└────────────────────────────────┘
```

#### Sections

- Header (type, label, close)
- Metadata (ID, status, confidence)
- Description
- Connections (incoming/outgoing)
- Evidence (supporting/contradicting)
- Provenance (source, timestamp)
- Actions (edit, delete, export)

---

### Timeline Component 🟢

**Purpose:** Temporal trace playback

#### Anatomy

```
┌────────────────────────────────────────┐
│ [⟲] [◀] [▶] [▶▶]  Speed: 1x     5/12 │  ← Controls
├────────────────────────────────────────┤
│ ●───●───●───●───●───●───●───●───●──●  │  ← Timeline
│ ↑                   ↑                  │
│ Past            Current                │
├────────────────────────────────────────┤
│ [Icon] Current Event                  │  ← Event details
│ Label: Evidence added                  │
│ Time: +2.5s                            │
└────────────────────────────────────────┘
```

#### Features

- Play/pause
- Step forward/backward
- Speed control (0.5x - 4x)
- Scrubber
- Event details
- Jump to event

---

### Compare View 🟢

**Purpose:** Side-by-side comparison of graphs

#### Layouts

**Side-by-side:**
```
┌──────────────┬──────────────┐
│ Before       │ After        │
│              │              │
│ Graph A      │ Graph B      │
│              │              │
└──────────────┴──────────────┘
```

**Stacked:**
```
┌──────────────────────────────┐
│ Before                       │
├──────────────────────────────┤
│ After                        │
└──────────────────────────────┘
```

**Unified:**
```
┌──────────────────────────────┐
│ - Removed item               │  ← Red
│ + Added item                 │  ← Green
│ ~ Modified item              │  ← Amber
│   Unchanged item             │
└──────────────────────────────┘
```

#### Features

- Linked scrolling
- Synchronized selection
- Change highlighting
- Diff summary
- Filter by change type

---

### Filter Bar 🟢

**Purpose:** Active filters display with quick removal

#### Anatomy

```
┌────────────────────────────────────────┐
│ [Filter] Filters active:               │
│ [Type: evidence ✕] [Status: verified ✕]│
│ [Clear all]                            │
└────────────────────────────────────────┘
```

---

### Triage Panel 🟢

**Purpose:** Prioritized list of items needing attention

#### Anatomy

```
┌────────────────────────────────┐
│ ⚠ 14 items need attention      │
├────────────────────────────────┤
│ ║ node-7d9  High priority      │
│ ║ Connection pool issue        │
│ ║ Confidence: 74%              │
├────────────────────────────────┤
│ ║ node-4a2  High priority      │
│ ║ Memory leak suspected        │
│ ║ Confidence: 68%              │
├────────────────────────────────┤
│ [View All]                     │
└────────────────────────────────┘

Color bar indicates priority:
║ Red = High
║ Amber = Medium
║ Steel = Low
```

---

### Contradiction Analysis Panel 🟢

**Purpose:** Display and analyze conflicts in reasoning

#### Anatomy

```
┌────────────────────────────────┐
│ ✕ Contradiction detected       │
├────────────────────────────────┤
│ Claim A vs Claim B             │
│                                │
│ Conflicts:                     │
│ • Network data contradicts     │
│   latency hypothesis           │
│ • CPU metrics don't support    │
│   compute-bound claim          │
├────────────────────────────────┤
│ [Highlight Path] [Show Evidence]│
└────────────────────────────────┘
```

---

### Evidence Grouping 🟢

**Purpose:** Organize evidence by support/contradict

#### Anatomy

```
┌────────────────────────────────┐
│ ✓ Supports (3 sources)         │  ← Green section
│   • Database logs              │
│   • Network metrics            │
│   • Config analysis            │
├────────────────────────────────┤
│ ✕ Contradicts (1 source)       │  ← Red section
│   • CPU utilization data       │
└────────────────────────────────┘
```

---

### Confidence Meter 🟢

**Purpose:** Visual confidence score display

#### Anatomy

```
Confidence: 74%
[████████████░░░░░░░░] 
 ← 0%           100% →

Color coding:
0-64%:    Coral (low)
65-84%:   Amber (medium)
85-100%:  Teal (high)
```

---

### Status Indicator 🟢

**Purpose:** Show verification status

#### Variants

```
✓ Verified       (teal)
⚠ Unresolved     (amber)
✕ Contradicted   (coral)
○ Pending        (steel)
```

---

## Page Templates

### Graph Kit Application 🟢

**Layout:**
```
┌──────────────────────────────────────┐
│ Navigation Bar                       │  64px
├──────────────────────────────────────┤
│ Control Bar (filters, view modes)    │  56px
├──────┬─────────────────────┬─────────┤
│ Side │                     │ Insp-   │
│ bar  │   Graph Canvas      │ ector   │
│      │                     │ Panel   │
│ 240px│                     │ 320px   │
├──────┴─────────────────────┴─────────┤
│ Timeline Panel                       │  200px
└──────────────────────────────────────┘
```

---

### Compare Mode View 🟢

**Layout:**
```
┌──────────────────────────────────────┐
│ Navigation Bar                       │
├──────────────────────────────────────┤
│ Compare Controls & Stats             │
├─────────────────┬────────────────────┤
│ Before (Run A)  │ After (Run B)      │
│                 │                    │
│                 │                    │
│                 │                    │
└─────────────────┴────────────────────┘
```

---

### Documentation Page 🟢

**Layout:**
```
┌──────────────────────────────────────┐
│ Navigation Bar                       │
├──────┬───────────────────────────────┤
│ Docs │                               │
│ Nav  │   Content Area                │
│      │   (markdown, components)      │
│ 240px│                               │
└──────┴───────────────────────────────┘
```

---

## Component States Reference

### Universal States

All interactive components support these states:

| State | Trigger | Visual Change |
|-------|---------|---------------|
| `default` | Initial state | Base styling |
| `hover` | Mouse over | Brightness increase, subtle lift |
| `active` | Mouse down | Brightness decrease, scale down |
| `focus` | Keyboard focus | Focus ring (2px path-blue) |
| `disabled` | Disabled prop | Opacity 40%, no pointer events |
| `loading` | Async operation | Spinner, disabled state |
| `error` | Validation fail | Red border, error message |

### Graph-Specific States

| State | Use Case | Visual Treatment |
|-------|----------|------------------|
| `selected` | User selection | 2px border, glow shadow |
| `related` | Connected to selection | 50% opacity border, subtle bg |
| `dimmed` | Filtered out | 40% opacity, muted |
| `highlighted` | Part of path | Emphasized color, glow |
| `verified` | Validation passed | Teal border, checkmark |
| `unresolved` | Needs attention | Amber border, warning icon |
| `contradicted` | Conflict detected | Coral border, X icon |

---

## Accessibility Requirements

All components must meet these standards:

✅ **Keyboard Navigation**
- All interactive elements reachable via Tab
- Logical tab order
- Enter/Space to activate
- Arrow keys for navigation in lists

✅ **Screen Reader Support**
- Semantic HTML elements
- ARIA labels where needed
- Live regions for dynamic content
- Descriptive alt text

✅ **Focus Management**
- Visible focus indicators
- Focus trap in modals
- Return focus after interactions

✅ **Color & Contrast**
- WCAG AA minimum (4.5:1 for text)
- Don't rely on color alone
- Test with color blindness simulators

---

## Component Checklist

Before marking a component as production-ready:

- [ ] All variants implemented
- [ ] All states functional
- [ ] Keyboard accessible
- [ ] Screen reader tested
- [ ] Responsive behavior defined
- [ ] Dark mode optimized
- [ ] Documentation complete
- [ ] Props/API documented
- [ ] Usage examples provided
- [ ] Edge cases handled
- [ ] Performance optimized
- [ ] Unit tests written

---

## Naming Conventions

### Component Names

- PascalCase: `GraphNode`, `FilterPanel`
- Descriptive: Name describes purpose
- Prefixed for domain: `Graph*` for graph components

### Props

- camelCase: `isDisabled`, `onSelect`
- Boolean props: `is*`, `has*`, `should*`
- Event handlers: `on*`
- Render props: `render*`

### Variants

- kebab-case: `primary`, `secondary`, `status-verified`
- Semantic names preferred over generic

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-13 | Initial component inventory |

---

## Next Steps

1. Implement remaining 🟡 and 🔵 components
2. Create Storybook documentation
3. Build component test suite
4. Generate usage examples
5. Create Figma component library sync

---

**Maintained by:** Restormel Design System Team  
**Last Review:** 2026-03-13
