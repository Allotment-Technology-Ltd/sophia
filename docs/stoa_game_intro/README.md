# Stoa Opening Arc v2 — What Changed and Why

## This package supersedes stoa-opening/ (v1) on every point of conflict.

---

## The four changes from v1

### 1. Name screen removed

STOA addresses everyone as "student." No name field in StoaProfile. No name in any system prompt.

**Why this is better:** Stripping social identity at the threshold is philosophically coherent. The title, the reputation, the self-performance dissolves. In here, you are student. The address creates equality across all who come. It is also historically accurate to Stoic pedagogy.

**What to do with any v1 name screen code:** Remove it. `StoaNameScreen.svelte` is not needed.

### 2. "Warm and welcoming" reconciled with "atmospheric"

The world is warm. The stone, the late light, the sea, the birdsong. STOA is interested and present, not cool or remote. But none of this warmth is announced — it is present in the environment. The student walks into it.

**What changed in the script:** Beat 1 lines are warmer. "You found the quiet corner." / "Come — sit." The academy receives the student without fanfare and without formality.

**What did NOT change:** The setup screens are still pure black. The world earns its visual reveal. The audio arrives before the image. These atmospheric choices remain because they are how warmth is *felt*, not *stated*.

### 3. Branching now initialises world state

Beat 3 (the sub-choice within the student's chosen path) now sets:
- The audio stance profile (music shifts immediately)
- The `primaryStruggleHint` used by assessment
- The `BEAT5_QUESTIONS` lookup key

The starting path (set in Screen 1) already set:
- Which zone loads
- What light state (morning / afternoon / dusk)
- The audio primary sound profile
- The default stance

**Three genuinely different opening experiences:**

| Path | Zone | Light | Sound | STOA position |
|---|---|---|---|---|
| Garden (peace) | garden | morning | birdsong primary | Seated by cistern, low |
| Colonnade (direction + uncertain) | colonnade | afternoon | sea primary | Seated against column |
| Sea Terrace (burden) | sea_terrace | dusk | sea close + loud | Standing at terrace edge |

### 4. Tone of setup screens

Screen 1 question: unchanged ("What brings you here?")
Screen 2 question: "Is there something specific **weighing on you**?" (softer than v1's "on your mind")
Screen 2 secondary text: "the conversations **tend to find it anyway**" (warmer than v1's version)

---

## What stayed the same

- Two setup screens (reason + struggle)
- STOA assesses through conversation (not questionnaire)
- Assessment is invisible to student — philosophyLevel set silently after Beat 6
- Returning students get different scripted greetings based on context
- All LLM calls route through vertex.ts
- SSE streaming pattern unchanged
- SurrealDB persistence unchanged (schema updated — name field removed)

---

## Files this creates or replaces

```
Removed:
  src/lib/components/stoa/setup/StoaNameScreen.svelte    (v1 — delete)

New or replaced:
  src/lib/types/stoa.ts                                  (updated — StartingPath, no name)
  scripts/setup-stoa-schema.ts                           (updated — no name field)
  src/lib/server/stoa/prologue/script.ts                 (v2 — path-aware beats)
  src/lib/server/stoa/prologue/returning-greetings.ts    (v2 — updated variants)
  src/lib/server/stoa/prologue/scene-initialiser.ts      (new — path-dependent scene setup)
  src/lib/server/stoa/profile-store.ts                   (v2 — no name field)
  src/routes/api/stoa/profile/+server.ts                 (v2 — no name in body)
  src/routes/api/stoa/prologue/assess/+server.ts         (v2 — no name in body)
  src/routes/api/stoa/prologue/returning-greeting/+server.ts (unchanged)
  src/lib/components/stoa/setup/StoaReasonScreen.svelte  (v2 — word-by-word reveal)
  src/lib/components/stoa/setup/StoaStruggleScreen.svelte (v2 — softer wording)
  src/lib/components/stoa/setup/StoaSetupContainer.svelte (v2 — two screens only)
  src/lib/stoa-scene/index.ts                            (updated — setLightState method)
  src/lib/stoa-audio/index.ts                            (updated — setPrimarySound method)
  src/lib/components/stoa/prologue/PrologueDialogue.svelte (updated — Beat 3 world init)
  src/lib/components/stoa/StoaApp.svelte                 (updated — path-aware loading)
```

---

## Build sequence

Run the 8 Cursor prompts from cursor-prompts/opening-arc-build-prompts-v2.md in order.

O.1 → O.2 → O.3 → O.4 → O.5 → O.6 → O.7 → O.8

Run `pnpm check` between each. Smoke test O.8 across both Peace and Burden paths.
