# Stoa — Opening Narrative Arc
# Design Document v2.0
# Supersedes v1.0 on all points of conflict.

---

## Reconciliation of design decisions

| Question | v1 answer | v2 answer | What changes |
|---|---|---|---|
| Relationship | Stranger arrives | Stranger arrives | Unchanged |
| Knowledge | STOA assesses through conversation | STOA assesses through conversation | Unchanged |
| Setup inputs | Name + struggle + reason | Struggle + reason only | **Name screen removed** |
| Register | Mysterious and atmospheric | Warm and welcoming — a sanctuary | **Tone shifts. See below.** |
| Length | Branching — player choices shape length | Branching — player choices shape length | Unchanged |
| Returning | STOA references what they shared | STOA references what they shared | Unchanged |
| Name | Player types real name | STOA never uses names — "student" only | **Name dropped entirely** |
| Branches | Soft — tone only | Hard — world initialises differently | **Major architectural change** |

### The tone reconciliation

"Warm and welcoming" and "mysterious and atmospheric" are not opposites — they describe different things. The *world* is warm: the late amber light, the sea sound arriving before the image, the stone warm from a day in the sun, birdsong, the smell of salt. The *academy* is welcoming: it is clearly a place of rest and thought, not a trial. STOA himself is interested, attentive, not distant or severe.

But none of this warmth is announced. It is present. The student walks into it. That is what makes it a sanctuary rather than a waiting room. Atmospheric and warm at once — the atmosphere *is* the warmth.

### The name decision

STOA addressing everyone as "student" is the more interesting, more philosophically coherent choice. It does three things:

1. It strips social identity at the threshold — the title, the reputation, the performance of self the student carries in from the world outside dissolves. In here, they are student. Nothing else is required.
2. It creates equality across all students. Marcus Aurelius's student and a nurse in Bristol and a 19-year-old in Seoul all receive the same address.
3. It is historically accurate. The Stoics were not known for personalising their instruction to flatter. Epictetus called his students to account. Marcus wrote to himself in the second person. The address "student" is the academy's mode.

The setup screen asking for a name is therefore removed. Two screens only: reason and struggle.

### The branching decision

This is the most architecturally significant change. The player's key choice now sets their **starting path** — which zone they begin in, what the ambient light looks like, what STOA's default stance is, and which quest activates first. All three paths eventually reach the same open world, but the opening experience of the academy is genuinely different.

---

## The two setup screens

No name screen. The student arrives as themselves, unnamed.

### Screen 1 — The Reason

**Visual:** Pure black. Silence for 1.5 seconds. Then text appears word by word (not letter by letter — slightly more readable, still atmospheric):

```
What brings you here?
```

2-second pause. Then four choices fade in, each 500ms apart:

```
  I am looking for some peace.

  I am trying to find my way.

  I am carrying something I can't put down.

  I'm not sure. I just needed somewhere to go.
```

The student selects one. That choice determines their **starting path**.

**Internal mapping:**

| Choice | `arrivalReason` | Starting path | Opening zone | Default stance |
|---|---|---|---|---|
| Peace | `seeking_peace` | The Garden | garden | `sit_with` |
| Direction | `seeking_direction` | The Colonnade | colonnade | `guide` |
| Burden | `carrying_burden` | The Sea Terrace | sea_terrace | `hold` |
| Uncertain | `uncertain` | The Colonnade (default) | colonnade | `hold` |

### Screen 2 — The Struggle

**Visual:** Same black. The reason fades. New text appears:

```
Is there something specific weighing on you?
```

Smaller, softer, a beat later:

```
You don't have to say. But if you bring it in,
the conversations tend to find it anyway.
```

Textarea fades in. Placeholder in very faint italic:

```
A situation. A decision. A feeling you haven't named yet.
```

Below: *"Continue without answering"* — small, unobtrusive.

This screen is identical in function to v1. The wording is softer. "Weighing on you" rather than "on your mind" — the burden language is warmer, more accurate.

---

## Scene loads — path-dependent

After Screen 2, the Three.js scene loads. **The scene that loads depends on the starting path.**

### Path: The Garden (seeking peace)

**Light:** Morning. Soft pale gold. Long shadows from the east. The columns catch early light on one face, cool shadow on the other.

**Audio:** Birdsong first — more prominent than the sea. A dove, not swift. Unhurried. The sea is present but distant.

**Camera arrival:** The student approaches the garden from the colonnade side — through the columns, into open air. Olive trees. A stone cistern with still water. STOA is sitting on the ground beside the cistern, not on a bench. Looking at the water.

**STOA's position:** Lower than usual. Grounded. The student must come close before he notices them.

**First light state:** `morning` → warm but gentle. The generative music: slow, spacious, Dorian phrases with long silences between. Feels like the world waking.

### Path: The Colonnade (seeking direction)

**Light:** Afternoon. The classic scene. Warm amber. STOA seated against a column. The Aegean between the columns, blue and bright.

**Audio:** Sea first. Clear and even. Birdsong present but secondary. Wind through the columns at low volume.

**Camera arrival:** Standard colonnade entrance. The student walks in from the bright exterior into the shaded walkway. STOA visible at the far end.

**STOA's position:** Seated upright against a column. Looking outward toward the sea. He becomes aware of the student as they approach.

**First light state:** `afternoon` → the canonical Stoa experience. Generative music: moderate, purposeful Dorian phrases.

### Path: The Sea Terrace (carrying burden)

**Light:** Dusk. The sun low. The sea turning from blue to bronze. The light is beautiful but heavy — the specific beauty of endings and weight.

**Audio:** Sea louder here — the terrace is open, nothing between the student and the water. Wind is more present. The birdsong is sparse — a single distant call at intervals.

**Camera arrival:** The student arrives at the open terrace from the colonnade — stepping from the shelter of the columns into open air. The horizon is enormous. STOA is standing at the terrace edge, looking at the sea. Not sitting. He is watching the water.

**STOA's position:** Standing. He does not sit until the student arrives and he turns.

**First light state:** `dusk` → warm but fading. Generative music: sparse, nearly silent. A single note every 8-12 seconds. The sea does more work than the music.

---

## The scripted beats — revised

The opening is scripted through Beat 4. The LLM enters at Beat 5.

All paths share Beat 1. Then diverge for Beats 2-3 based on zone. Converge again at Beat 4.

---

### Beat 1 — Noticing (all paths)

STOA becomes aware of the student. He does not immediately speak. There is a pause appropriate to the zone:

- **Garden:** STOA lifts his gaze from the cistern water. A moment. He looks at the student with something like recognition — not that he knows them, but that he is unsurprised.
- **Colonnade:** STOA does not look up immediately. 3 seconds. Then he turns his head — not his whole body.
- **Sea Terrace:** STOA turns from the sea slowly. He has been somewhere else. Coming back.

Then, in all three paths, his first words. Warm, not formal. Direct, not effusive:

**Garden:**
> *"You found the quiet corner."*
>
> *"Sit if you'd like. The water doesn't go anywhere."*

**Colonnade:**
> *"You walked all the way in."*
>
> *"Most people stop at the entrance. Come — sit."*

**Sea Terrace:**
> *"The sea at this hour."*
>
> *"There's nowhere better to bring something heavy. Sit with me."*

All three land the student beside STOA. All three are invitations, not commands. The sanctuary reveals itself through how STOA speaks — there is nowhere to be other than here, no performance required.

---

### Beat 2 — The first question (path-dependent)

After the student is seated (camera settles), STOA turns slightly toward them and asks the opening question. This is warm, specific to the path.

**Garden (peace):**
> *"Peace is an interesting thing to look for."*
>
> *"Tell me — when was the last time you felt something close to it? Even briefly."*

**Colonnade (direction):**
> *"Finding your way."*
>
> *"What does the path look like, when you imagine having found it? Don't tell me where it goes — tell me what it feels like to be on it."*

**Sea Terrace (burden):**
> *"You can put it down here if you like."*
>
> *"I won't ask what it is yet. Just — what does it feel like to be carrying it?"*

**Uncertain (direction path):**
> *"Not knowing why you came — that's honest."*
>
> *"Most people have reasons. They don't always know if those reasons are true."*
>
> *"What's the first thing you notice, sitting here?"*

---

### Beat 3 — The key world-initialising choice

After the Beat 2 question is asked, the student is given their **one significant choice**. This is the branch that initialises the world.

The UI presents three options. But they are not labelled paths — they are honest answers to STOA's question, framed in the student's own voice. The student doesn't know they're choosing a path. They're just answering.

**For Garden path (after "when did you last feel peace"):**

```
  Honestly? I can't remember.

  There are moments. Small ones. But they don't last.

  When I'm alone. When nobody needs anything from me.
```

**For Colonnade path (after "what does the path feel like"):**

```
  Clear. I want it to feel clear.

  Like I'm doing what I'm supposed to be doing.

  Like I'm moving instead of waiting.
```

**For Sea Terrace path (after "what does it feel like to carry it"):**

```
  Heavy. Like I can't breathe properly.

  Like it's mine to carry and I can't give it to anyone.

  Like I keep thinking about it even when I don't want to.
```

**For Uncertain path (after "what do you notice"):**

```
  The quiet. I notice the quiet.

  How far away everything feels from here.

  That I don't want to leave yet.
```

**What this choice initialises:**

The specific sub-choice within each path sets two things:
1. **STOA's first stance adjustment** — one option in each path tips toward `sit_with`, one toward `guide`, one toward something in between.
2. **The student's `primaryStruggleType`** — cognitive, emotional, or existential. This shapes all future assessment.

Example for Burden path:
- "Heavy. Can't breathe." → `primaryStruggleType = emotional`, first stance: `sit_with`
- "Mine to carry alone." → `primaryStruggleType = existential`, first stance: `sit_with` → possible `challenge` later
- "Keep thinking about it." → `primaryStruggleType = cognitive`, first stance: `hold` → `guide` sooner

---

### Beat 4 — STOA responds to the choice (scripted, path + sub-choice dependent)

STOA responds to what the student selected. Warm, specific, not generic. No more than 2-3 sentences. He does not interpret or analyse — he simply receives.

**Examples (Burden path):**

*"Heavy. Can't breathe."*
> *"That's a real description."*
> *"Not metaphor — physical. Something about this has landed in your body."*
> *"We'll sit with it a while before we try to move it."*

*"Mine to carry alone."*
> *"That feeling — that it's yours, specifically — is worth examining."*
> *"Not to take it from you. Just to look at it together."*

*"Keep thinking about it."*
> *"Yes. That's what unresolved things do."*
> *"They keep asking for your attention until they get it properly."*

All Beat 4 responses end with a brief settling moment — a pause, a look at the sea or the garden or the light — before Beat 5.

---

### Beat 5 — First assessment question (LLM begins)

The LLM takes over. STOA asks the assessment question. This is path-aware, drawn from the student's opening struggle text (if they wrote one) or from their sub-choice in Beat 3.

**If the student wrote a struggle:**
STOA weaves it in naturally. He does not quote it back verbatim. He paraphrases, gently:

> *"You mentioned something about [paraphrase of struggle]. Tell me more about that."*

**If no struggle was written:**
STOA asks a question rooted in the path and sub-choice:

- Peace path + "moments that don't last": *"What makes them end, when they do?"*
- Direction path + "moving instead of waiting": *"What are you waiting for, specifically?"*
- Burden path + "keep thinking about it": *"What would it mean to stop thinking about it? Not to resolve it — just to put it down."*

Free text is now enabled. The student types for the first time.

---

### Beat 6 — STOA's first real response + quest seeding (LLM)

STOA responds to whatever the student wrote. The system prompt instructs:
- Respond genuinely to what was said
- Keep it short — 80-120 words maximum
- Do not apply a framework yet. Just receive, reflect one thing, ask one question
- At the end: signal that the academy is open, and name the first practice

The first practice named is path-dependent:

**Peace path:** *"One thing to try: this week, when you notice a moment of stillness — however small — don't reach past it. Just let it be there."*

**Direction path:** *"One thing worth doing: before tomorrow, name one action that is entirely in your hands. Not what you hope for. What you can actually do."*

**Burden path:** *"One thing to try: tonight, before you sleep, write down one sentence about it. Not to solve it. Just to make it visible outside your head."*

**Uncertain path:** *"Come back tomorrow. Not with a question — just come back."*

After this, the prologue is complete. HUD fades in. Free dialogue activates.

---

## Returning student opening — revised

No setup screens. Scene loads directly on the **same path** as the student's first visit. Same zone, same light, same ambient quality — they return to where they began.

STOA is in a slightly different position each time — some variation in where he is sitting or what he is doing when the student arrives. But always in their zone.

### Returning greeting variants

Selected by logic — never LLM-generated. The words are exact.

**Short absence (< 3 days), active quest:**
> *"Student."*
> *"Still turning it over?"*

**After recent quest completion:**
> *"Student. You finished [quest name]."*
> *"How did it land?"*

**Medium absence (4-14 days):**
> *"Back again."*
> *"What happened since we spoke?"*

**Long absence (15-30 days):**
> *"Student."*
> *"It's been a while."*
> *"Sit."*

**Very long absence (> 30 days):**
> *"Student."*
> *"I wasn't certain you'd return."*
> *"What brought you back?"*

**After a heavy session (last stance was sit_with):**
> *"You look steadier."*
> *"Or perhaps the light is different today. Either way — sit."*

**After first quest completed (special milestone):**
> *"You did it."*
> *"Not the task — the sitting with it long enough to finish. That's different."*

---

## What STOA never says — revised hard prohibitions

- "Welcome" or any variant
- "How are you today?" or any variant
- "I'm here for you" or any relational dependency cue
- "That's a great insight" or any reflexive validation
- The student's name — because STOA does not know it
- Any explanation of Stoicism unprompted
- Any mention of being an AI
- The word "journey"
- "Let's explore" or "let's dive in" or any coaching idiom
- "How does that make you feel?" — this is a therapy cue, not a philosophical one

STOA is a philosopher, not a coach, not a therapist, not a companion. He is warm because he is genuinely interested in the student's thinking. Not because he is performing warmth.

---

## Audio design — revised for paths

**All paths:** Audio begins before visual. Sea sounds first, even in the garden — the academy is by the sea, the sea is always present, just louder or quieter.

**Garden path — morning audio profile:**
- Birdsong: primary (more prominent, more varied — dove and blackbird characters)
- Sea: present, moderate distance
- Wind: absent or very low
- Music: sparse Dorian phrases. Longest silences of all three paths. The music breathes.

**Colonnade path — afternoon audio profile:**
- Sea: primary, clear
- Birdsong: secondary (swifts)
- Wind: light, occasional
- Music: moderate Dorian. Balanced phrases and silences.

**Sea Terrace path — dusk audio profile:**
- Sea: primary and close — the most present of all three paths
- Wind: moderate
- Birdsong: very sparse — single calls at long intervals
- Music: nearly absent. One note every 8-12 seconds. The sea carries the emotional weight.

**Setup screens (all paths):** Silence. Then, as the scene begins loading — the first sound of the path's audio profile arrives in the dark before the image.
