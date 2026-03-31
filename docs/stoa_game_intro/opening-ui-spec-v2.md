# Stoa — Opening UI Specification v2
# No name screen. Two setup screens. Path-dependent world initialisation.

---

## Global styles (unchanged from v1)

```css
background: #000000;
color: #E8DCC8;
font-family: 'Cormorant Garamond', Georgia, serif;
font-size: 22px;
font-style: italic;
line-height: 1.75;
text-align: center;
```

---

## Screen 1: The Reason

### Component: `StoaReasonScreen.svelte`

**Sequence:**

1. Pure black. 1.5s silence.

2. Question text appears word by word (not letter by letter — a warmer reveal):
   ```
   What brings you here?
   ```
   Each word fades in with a 60ms delay between words. Gentler than letter-by-letter.

3. 2s pause.

4. Four options appear, each fading in with 500ms between:
   ```
   I am looking for some peace.

   I am trying to find my way.

   I am carrying something I can't put down.

   I'm not sure. I just needed somewhere to go.
   ```

   Option styling:
   ```css
   font-size: 19px;
   font-style: italic;
   color: rgba(232, 220, 200, 0.72);
   cursor: pointer;
   padding: 14px 0;
   letter-spacing: 0.01em;
   transition: color 250ms, letter-spacing 250ms;

   &:hover {
     color: rgba(232, 220, 200, 1.0);
     letter-spacing: 0.025em;
   }
   ```

5. On hover: selected option brightens fully, others dim to 0.35 opacity.
6. On click: selected option holds bright. Others fade to 0.08. 1s pause. Screen fades. Screen 2 begins.

**Data stored:** `profile.arrivalReason`, `profile.startingPath`

---

## Screen 2: The Struggle

### Component: `StoaStruggleScreen.svelte`

**Sequence:**

1. 800ms black between screens.

2. Primary text appears word by word:
   ```
   Is there something specific weighing on you?
   ```

3. 1.5s pause. Secondary text fades in (opacity 0 → 1, 900ms):
   ```css
   font-size: 16px;
   color: rgba(232, 220, 200, 0.48);
   ```
   ```
   You don't have to say. But if you bring it in,
   the conversations tend to find it anyway.
   ```

4. 1.2s pause. Textarea fades in:
   ```css
   width: 100%;
   max-width: 520px;
   min-height: 88px;
   background: transparent;
   border: none;
   border-bottom: 1px solid rgba(232, 220, 200, 0.22);
   color: rgba(232, 220, 200, 0.9);
   font-style: italic;
   ```
   Placeholder (opacity 0.3):
   ```
   A situation. A decision. A feeling you haven't named yet.
   ```

5. After 1.2s more: *"Continue without answering"* fades in below.
   ```css
   font-size: 13px;
   font-style: normal;
   color: rgba(232, 220, 200, 0.32);
   text-decoration: underline;
   text-underline-offset: 3px;
   cursor: pointer;
   ```

6. On submit (Enter×2 or "→" button): brief text replacement:
   The textarea content fades. A single line fades in for 600ms:
   ```
   Carried.
   ```
   Then everything fades. Scene load begins.

7. On skip: immediate fade. Scene load begins.

**Data stored:** `profile.openingStruggle` (or null)

---

## Scene load: path-dependent, audio-first

After Screen 2, Three.js scene loads based on `startingPath`.

**Universal sequence:**
1. Black screen remains.
2. **Audio arrives before image — always.** The path's primary sound begins at volume 0, ramps up over 4s.
3. After 2s of audio: scene begins rendering (loading internally).
4. After scene is ready: slow fade from black to scene (3s).

**Loading message** (appears after 1.5s of black, if still loading):
```
The academy is close.
```
Font: Cormorant Garamond italic, 15px, rgba(232, 220, 200, 0.28). Centered.
If loading > 30s: add below: *"Try refreshing if this persists."*

### Path-specific scene entry

**Garden (peace):**
- Light: morning pale gold. Low sun angle from east.
- Camera arrives at garden entrance — through colonnade columns into open air.
- STOA seated on ground beside stone cistern. Low. Grounded.
- Birdsong prominent in audio.

**Colonnade (direction + uncertain):**
- Light: afternoon amber. The canonical Stoa scene.
- Camera arrives at colonnade entrance. Standard approach.
- STOA seated against column. Looking outward.
- Sea prominent in audio.

**Sea Terrace (burden):**
- Light: dusk. Bronze sea. Heavy beauty.
- Camera arrives at terrace edge from colonnade side.
- STOA standing at terrace edge. Looking at sea. He turns when student arrives.
- Sea close and loud. Music nearly absent.

---

## Prologue dialogue UI: revised

### Beat 1 (no input)

STOA's lines appear word by word (60ms/word — same tempo as setup screens).
No input accepted. Auto-advances after final line.

The DialogueOverlay in prologue mode:
```css
/* Warmer parchment — slightly higher opacity than open-world */
background: rgba(30, 27, 22, 0.90);
border: 1px solid rgba(200, 170, 120, 0.35);
border-radius: 14px;
padding: 28px 36px;
```

No stance indicator during prologue. No HUD. No quest markers. Nothing except the world and the words.

### Beat 2 (no input — STOA speaks)

STOA's opening question appears the same way. Then 1.5s pause. Then the choice options fade in.

### Beat 3 (the key choice — world-initialising)

Choice options styling — warmer than Screen 1 options (we are now in the world):
```css
font-size: 18px;
font-style: italic;
color: rgba(232, 220, 200, 0.70);
padding: 13px 0;
cursor: pointer;
transition: color 250ms;

&:hover {
  color: rgba(232, 220, 200, 1.0);
}
```

Small instruction above options — fades in 700ms after options appear:
```css
font-size: 12px;
font-style: normal;
font-family: 'JetBrains Mono', monospace;
color: rgba(232, 220, 200, 0.28);
letter-spacing: 0.05em;
margin-bottom: 20px;
```
```
choose one
```

On selection: selected brightens, others fade to 0.06. 1.2s pause.
**World initialises** in the background (lighting shift, audio profile adjusts).
Beat 4 begins.

### Beat 4 (scripted, no input)

STOA's 2-3 line response. Each line appears after the previous with a 700ms pause between them.
After all lines: 2s pause. Beat 5 begins.

### Beat 5 (free text unlocks — LLM begins)

A subtle transition: the choice UI fades completely (400ms). The textarea input fades in (600ms).

No instruction text. Just the cursor blinking in the input area.

STOA's Beat 5 question has already appeared. The input is now open.

The student types and submits.

### Beat 6 (LLM response — streaming)

Standard SSE streaming. Text appears as it arrives, character by character.

After the response completes and the quest practice line is delivered:

1. A 3s pause.
2. STOA adds — as a very quiet final line:
   ```
   The academy is open.
   ```
   This appears word by word, slower than usual (90ms/word). Muted opacity (0.65).
3. 2s pause.
4. HUD elements fade in sequentially.

---

## HUD activation sequence

Each element fades in separately, 700ms between each:

1. **Stance indicator** (bottom-left) — appears first, showing `sit_with`, `hold`, or `guide` based on starting path
2. **Quest journal icon** (bottom-right) — a small scroll icon
3. **Audio controls** (top-right) — mute and volume
4. **Progress display** (bottom-right, very subtle) — "The Seeker · 0 XP"

No announcements. No "tutorial complete" banners. The world simply opens.

---

## Returning student scene

No setup screens. No cinematic camera movement.

Scene loads directly in the student's starting path zone, their starting light state.
Camera is already in conversational position.

STOA is in a slightly varied position — one of three preset variants per zone, rotated daily so returning students see some variation.

Scripted greeting appears in DialogueOverlay immediately. Word by word. Then free dialogue.

---

## Accessibility minimums (v2)

- Word-by-word reveals: respect `prefers-reduced-motion` — replace with opacity fade-in per element.
- Screen 1-2: full keyboard navigation (arrow keys for options, Enter to select).
- Screen 2 textarea: Tab reaches skip link, Enter submits when button is focused.
- All STOA dialogue: in an `aria-live="polite"` region.
- Loading message: visible to screen readers.
- Colour contrast: all parchment text (#E8DCC8) on pure black (#000000) passes WCAG AA at all sizes used.

---

## Type data model: `StoaProfile` v2 (no name field)

```typescript
interface StoaProfile {
  userId: string
  arrivalReason: ArrivalReason
  startingPath: StartingPath                // 'garden' | 'colonnade' | 'sea_terrace'
  beat3Choice: string                        // exact text of the sub-choice selected
  openingStruggle: string | null
  openingStruggleEmbedding: number[] | null
  philosophyLevel: PhilosophyLevel | null
  thinkingStyle: ThinkingStyle | null
  emotionalPresence: 'present' | 'defended' | 'unclear' | null
  primaryStruggleType: 'cognitive' | 'emotional' | 'existential' | 'unclear' | null
  suggestedOpeningStance: StanceType | null
  firstSessionId: string
  createdAt: string
  lastSeenAt: string
  totalSessions: number
}
```

Note: `name` field removed entirely. `startingPath` added. `beat3Choice` added.
