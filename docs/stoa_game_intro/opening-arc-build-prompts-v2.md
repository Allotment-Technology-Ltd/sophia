# Cursor Build Prompts — Stoa Opening Arc v2
# Supersedes v1 build prompts entirely.
# Paste each into Cursor Agent in order. Run pnpm check between each.

---

## Prompt O.1 — Revised types and schema (replaces v1 O.1)

**Agent: Game Logic Builder**

```
Read these files first:
- src/lib/types/stoa.ts (existing — check for any v1 types to remove or update)
- scripts/setup-stoa-schema.ts (existing)

IMPORTANT: The name field has been removed from the design. If src/lib/types/stoa.ts
contains a 'name' field in StoaProfile from a previous version, remove it now.

Update src/lib/types/stoa.ts with these types (add or replace as needed):

1. ArrivalReason type:
   'seeking_peace' | 'seeking_direction' | 'carrying_burden' | 'uncertain'

2. StartingPath type:
   'garden' | 'colonnade' | 'sea_terrace'

3. PhilosophyLevel type: 'novice' | 'familiar' | 'practised'
4. ThinkingStyle type: 'concrete' | 'abstract' | 'mixed'

5. StoaProfile interface (NO name field):
   userId: string
   arrivalReason: ArrivalReason
   startingPath: StartingPath
   beat3Choice: string                    -- exact text of sub-choice selected
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

6. PrologueState type:
   'setup_reason' | 'setup_struggle' |
   'loading_scene' | 'cinematic' |
   'beat_1' | 'beat_2' | 'beat_3' | 'beat_4' | 'beat_5' | 'beat_6' |
   'open_world'

7. StartingPathConfig interface:
   path: StartingPath
   zone: StoaZone
   lightState: 'morning' | 'afternoon' | 'dusk'
   defaultStance: StanceType
   audioPrimarySound: 'birdsong' | 'sea' | 'sea_close'

8. Export STARTING_PATH_CONFIG: Record<StartingPath, StartingPathConfig>:
   garden:      { zone: 'garden',      lightState: 'morning',   defaultStance: 'sit_with', audioPrimarySound: 'birdsong' }
   colonnade:   { zone: 'colonnade',   lightState: 'afternoon', defaultStance: 'guide',    audioPrimarySound: 'sea' }
   sea_terrace: { zone: 'sea_terrace', lightState: 'dusk',      defaultStance: 'hold',     audioPrimarySound: 'sea_close' }

Update scripts/setup-stoa-schema.ts:
Add/replace stoa_profile table — NO name field:
   DEFINE TABLE stoa_profile SCHEMAFULL;
   DEFINE FIELD user_id ON stoa_profile TYPE record<user>;
   DEFINE FIELD arrival_reason ON stoa_profile TYPE string;
   DEFINE FIELD starting_path ON stoa_profile TYPE string;
   DEFINE FIELD beat3_choice ON stoa_profile TYPE string;
   DEFINE FIELD opening_struggle ON stoa_profile TYPE option<string>;
   DEFINE FIELD philosophy_level ON stoa_profile TYPE option<string>;
   DEFINE FIELD thinking_style ON stoa_profile TYPE option<string>;
   DEFINE FIELD emotional_presence ON stoa_profile TYPE option<string>;
   DEFINE FIELD primary_struggle_type ON stoa_profile TYPE option<string>;
   DEFINE FIELD suggested_opening_stance ON stoa_profile TYPE option<string>;
   DEFINE FIELD first_session_id ON stoa_profile TYPE string;
   DEFINE FIELD created_at ON stoa_profile TYPE datetime DEFAULT time::now();
   DEFINE FIELD last_seen_at ON stoa_profile TYPE datetime DEFAULT time::now();
   DEFINE FIELD total_sessions ON stoa_profile TYPE int DEFAULT 0;
   DEFINE INDEX idx_stoa_profile_user ON stoa_profile COLUMNS user_id UNIQUE;
```

---

## Prompt O.2 — Prologue script v2

**Agent: Dialogue Integrator**

```
Read these files first:
- src/lib/types/stoa.ts (updated)
- docs/stoa/opening-narrative-v2.md (the v2 narrative document)

Create src/lib/server/stoa/prologue/script.ts (replace any v1 version):

This file is the complete scripted dialogue for Beats 1-4. All text is verbatim.
No LLM generation. Exact strings.

Export:

1. BEAT1_LINES: Record<StartingPath, string[]>
   Each path gets 2 lines. From the narrative doc. Exact text.

2. BEAT2_LINES: Record<StartingPath, string[]>
   Each path gets 2-3 lines. The opening question at end. From narrative doc.

3. BEAT3_OPTIONS: Record<ArrivalReason, Beat3Option[]>
   interface Beat3Option {
     text: string          -- the exact text the student selects
     stanceSignal: StanceType
     primaryStruggleHint: 'cognitive' | 'emotional' | 'existential'
   }
   All options from the narrative doc. Verbatim.
   Note: 'uncertain' arrivalReason uses colonnade Beat3Options.

4. BEAT4_RESPONSES: Record<StartingPath, Record<string, string[]>>
   Keyed by the exact Beat3 option text.
   Each response is an array of 2-3 short sentences displayed sequentially.
   All text from system-prompts-v2.md BEAT4 matrix. Verbatim.

5. BEAT5_QUESTIONS: Record<StartingPath, Record<string, string>>
   Outer key: startingPath
   Inner key: beat3Choice text
   Value: the assessment question STOA asks before free text opens
   Write these now based on the narrative doc guidance:
   - Garden + "can't remember peace": "What makes them end, when they do?"
   - Garden + "moments don't last": "What were you doing when you last felt it, even briefly?"
   - Garden + "alone, nobody needs me": "Is that rest, or something else?"
   - Colonnade + "clear": "What's making it murky right now?"
   - Colonnade + "supposed to": "Whose sense of supposed-to is it?"
   - Colonnade + "moving not waiting": "What exactly are you waiting for?"
   - Sea Terrace + "can't breathe": "Where does it sit in your body?"
   - Sea Terrace + "mine to carry": "When did you decide it was yours alone?"
   - Sea Terrace + "keep thinking": "What would it mean to stop — even for an hour?"
   - Uncertain + "quiet": "What does it feel like to be in quiet right now?"
   - Uncertain + "far away": "Is that relief, or something lonelier?"
   - Uncertain + "don't want to leave": "What is it you don't want to go back to?"

6. ASSESSMENT_QUESTIONS (fallback — used when openingStruggle is null AND beat5 question lookup fails):
   Record<StartingPath, string>
   garden: "When was the last time you didn't feel like you needed to be somewhere else?"
   colonnade: "What would it mean to know you were on the right path?"
   sea_terrace: "What would it look like to put it down, even for a few minutes?"

7. QUEST_SEEDS: Record<StartingPath, string>
   The practice STOA names at the end of Beat 6. Verbatim from system prompt doc.

8. BEAT6_CLOSING_LINE: string
   "The academy is open."
   (Displayed after the LLM response. Word by word. 90ms per word. Muted.)
```

---

## Prompt O.3 — Returning greetings and profile store

**Agent: Dialogue Integrator**

```
Read these files first:
- src/lib/types/stoa.ts (updated)
- docs/stoa/opening-narrative-v2.md (returning student section)

Create src/lib/server/stoa/prologue/returning-greetings.ts:

interface ReturningGreetingContext {
  startingPath: StartingPath
  daysSince: number
  lastStance: StanceType
  hasActiveQuest: boolean
  activeQuestTitle?: string
  recentCompletion?: string
  totalSessions: number
  isFirstQuestComplete: boolean
}

function selectReturningGreeting(ctx: ReturningGreetingContext): {
  variant: string
  lines: string[]
}

Variant selection logic (in priority order):
1. isFirstQuestComplete AND first time this milestone seen → variant 'first_quest_milestone'
2. recentCompletion exists → variant 'post_completion'
3. daysSince > 30 → variant 'very_long_absence'
4. daysSince > 14 → variant 'long_absence'
5. lastStance === 'sit_with' → variant 'post_heavy_session'
6. hasActiveQuest AND daysSince < 4 → variant 'short_absence_active_quest'
7. default → variant 'medium_absence'

All response lines verbatim from the narrative doc. 
{questTitle} is a template token replaced at call time.

Create src/lib/server/stoa/profile-store.ts (replace v1 if exists):
All functions as before EXCEPT:
- Remove any 'name' references
- Add: getStartingPath(userId): Promise<StartingPath | null>
- Add: getProfileComplete(userId): Promise<boolean>  -- true if philosophyLevel is set
```

---

## Prompt O.4 — Setup screen components v2

**Agent: Dialogue Integrator**

```
Read these files first:
- docs/stoa/opening-ui-spec-v2.md (full UI spec)
- src/lib/types/stoa.ts (updated — no name field)
- src/lib/components/stoa/ (list existing — remove or update any v1 name screen)

Remove or archive any StoaNameScreen.svelte from v1. We do not need it.

Create:

1. src/lib/components/stoa/setup/StoaReasonScreen.svelte (Svelte 5)
   Props: none
   Emits: 'complete' with { reason: ArrivalReason, startingPath: StartingPath }
   
   Word-by-word text reveal (not letter-by-letter):
   Split text into words. Each word spans with opacity: 0 → 1 and slight
   translateY: 4px → 0px. 60ms delay between words.
   
   Question: "What brings you here?"
   
   Four options, 500ms fade-in stagger.
   Exact option texts from the narrative doc.
   
   Mapping:
   - "I am looking for some peace." → reason: seeking_peace, path: garden
   - "I am trying to find my way." → reason: seeking_direction, path: colonnade
   - "I am carrying something I can't put down." → reason: carrying_burden, path: sea_terrace
   - "I'm not sure. I just needed somewhere to go." → reason: uncertain, path: colonnade
   
   On click: emit 'complete'. Screen fades over 800ms.

2. src/lib/components/stoa/setup/StoaStruggleScreen.svelte (Svelte 5)
   Props: { startingPath: StartingPath }
   Emits: 'complete' with { struggle: string | null }
   
   Identical to v1 spec EXCEPT:
   - Primary question: "Is there something specific weighing on you?"
   - Secondary text: "You don't have to say. But if you bring it in,\nthe conversations tend to find it anyway."
   
   On submit with content: show "Carried." for 600ms. Emit with struggle text.
   On skip: emit immediately with null.

3. src/lib/components/stoa/setup/StoaSetupContainer.svelte (Svelte 5)
   State: 'reason' | 'struggle' | 'complete'
   
   No name state. Two screens only.
   
   Collects: { reason, startingPath, struggle }
   On 'complete': POST /api/stoa/profile with { arrivalReason, startingPath, openingStruggle }
   Then emit 'setupComplete' with { profile: StoaProfile }
   
   800ms black cross-fade between screens.

CSS: Use CSS custom properties. No Tailwind.
All animations respect prefers-reduced-motion (replace with fade-in).
```

---

## Prompt O.5 — Path-dependent scene loading and cinematic

**Agent: Scene Architect + Dialogue Integrator**

```
Read these files first:
- src/lib/stoa-scene/index.ts (existing)
- src/lib/stoa-scene/zones/index.ts (ZoneManager)
- src/lib/stoa-scene/systems/day-cycle.ts (if exists — check)
- src/lib/types/stoa.ts (updated — StartingPathConfig)

Create src/lib/server/stoa/prologue/scene-initialiser.ts:
A pure TypeScript module (no Svelte).

SceneInitialiser class:
  constructor(scene: StoaScene, audio: AudioEngine)
  
  async initialise(config: StartingPathConfig): Promise<void>
    1. Set zone: await scene.loadZone(config.zone)
    2. Set light: scene.setLightState(config.lightState)
    3. Set audio zone: audio.setZone(config.zone)
    4. Adjust audio primary sound: audio.setPrimarySound(config.audioPrimarySound)
    5. Set default stance in audio: audio.setStance(config.defaultStance)

Update src/lib/stoa-scene/index.ts:
Add method: setLightState(state: 'morning' | 'afternoon' | 'dusk'): void
  - morning: sun at low angle east, ambient cool blue, scene.fog colour pale gold
  - afternoon: sun high-ish, warm amber, default state — same as current implementation
  - dusk: sun low west, deep amber/bronze, ambient warmer, shadows longer
  Each state: transition over 2s using THREE.Color.lerp between current and target values.

Update src/lib/stoa-audio/index.ts:
Add method: setPrimarySound(sound: 'birdsong' | 'sea' | 'sea_close'): void
  - birdsong: raise birdsong howl volume to 0.55, lower sea to 0.15
  - sea: standard profile (sea 0.35, birdsong 0.22)
  - sea_close: sea volume 0.55, birdsong very sparse (0.08), wind 0.22

Update src/lib/components/stoa/StoaApp.svelte:
After StoaSetupContainer emits 'setupComplete':
  1. Store profile in stoa-session store
  2. Get StartingPathConfig from STARTING_PATH_CONFIG[profile.startingPath]
  3. Begin scene load
  4. Audio starts in the black — setPrimarySound for this path
  5. When scene ready: SceneInitialiser.initialise(config)
  6. Cinematic approach specific to zone (see below)
  7. Show PrologueDialogue

Cinematic approaches per zone:
  - Garden: camera moves from colonnade-side entrance toward garden cistern (gentle arc)
  - Colonnade: standard forward approach to conversational position
  - Sea Terrace: camera sweeps from colonnade opening to terrace edge (wider arc, reveals horizon)

All cinematics: 6s duration, ease-in-out, ends at conversational distance from STOA.
```

---

## Prompt O.6 — Beat 3 world initialisation

**Agent: Dialogue Integrator**

```
Read these files first:
- src/lib/server/stoa/prologue/script.ts (just created — has BEAT3_OPTIONS)
- src/lib/components/stoa/prologue/PrologueDialogue.svelte (existing)
- src/lib/types/stoa.ts

Update src/lib/components/stoa/prologue/PrologueDialogue.svelte:

Beat 3 is the world-initialising choice. When the student selects a Beat 3 option:

1. Record selection: update local state with { beat3Choice: selectedText }
2. Emit 'beat3Selected' event with { beat3Choice, stanceSignal, primaryStruggleHint }
3. PATCH /api/stoa/profile with { beat3Choice: selectedText }
4. Dispatch 'stanceUpdate' to the AudioEngine: audio.setStance(stanceSignal)
5. Begin Beat 4 (display BEAT4_RESPONSES for this path + beat3Choice)

The world does NOT change zone at this point — that was set at scene load.
The light does NOT change at Beat 3.
What changes at Beat 3:
- Audio stance reactivity (music shifts based on stanceSignal)
- Internal profile.primaryStruggleHint recorded
- The BEAT5_QUESTIONS lookup key is now known

Ensure:
- BEAT4_RESPONSES lookup handles all exact beat3Choice text strings
- If an exact match isn't found: fall back to the first option's response for that path
- Log missing keys so they can be added later

After Beat 4 completes:
- 2s pause
- STOA's Beat 5 question appears (from BEAT5_QUESTIONS[path][beat3Choice])
  If beat3Choice key not found: use ASSESSMENT_QUESTIONS[path] as fallback
- Free text input fades in
- Beat 5 begins
```

---

## Prompt O.7 — Profile API and returning player wiring

**Agent: Dialogue Integrator**

```
Read these files first:
- src/lib/server/stoa/profile-store.ts (updated v2)
- src/routes/api/stoa/ (list existing routes)

Create/replace:

1. src/routes/api/stoa/profile/+server.ts
   GET: return current user's StoaProfile (null if first visit)
   POST: create profile
     Body: { arrivalReason: ArrivalReason, startingPath: StartingPath, openingStruggle: string | null }
     No name field.
     Generate openingStruggleEmbedding via embeddings.ts if struggle provided.
     Return: { profile: StoaProfile, isNewStudent: true }
   PATCH: update fields
     Body: Partial<StoaProfile> — safe fields only (no userId, no createdAt)
   Auth required.

2. src/routes/api/stoa/prologue/assess/+server.ts
   POST — called after Beat 6 LLM response to classify student
   Body: {
     arrivalReason: ArrivalReason
     startingPath: StartingPath
     beat3Choice: string
     openingStruggle: string | null
     beat5Question: string
     studentResponse: string
   }
   Uses ASSESSMENT EVALUATION PROMPT from system-prompts-v2.md
   Calls vertex.ts → generateObject (structured JSON, not streamed)
   Stores result to stoa_profile via profile-store.ts
   Returns: { philosophyLevel, suggestedOpeningStance }
   Auth required.

3. src/routes/api/stoa/prologue/returning-greeting/+server.ts
   GET — for returning students
   Loads profile, last session, active quests, recent completions
   Calls selectReturningGreeting(ctx)
   Returns: { variant, lines: string[], path: StartingPath }
   Auth required.

Update src/routes/api/stoa/dialogue/+server.ts:
When isReturningStudent (philosophyLevel is set):
  Inject RETURNING STUDENT SYSTEM PROMPT EXTENSION (from system-prompts-v2.md)
  Provide: arrivalReason, startingPath, philosophyLevel, thinkingStyle, 
           primaryStruggleType, daysSince, lastStance, activeQuestTitles, 
           recentCompletions, openingStruggle (may be null)
  Note: NO name field — address as 'student' or not at all.
```

---

## Prompt O.8 — Integration test and smoke check

**Agent: General**

```
Run full v2 integration check. Note: v1 had a name screen — verify it is gone.

1. pnpm check — fix TypeScript errors in stoa files only.

2. Verify no name field exists:
   grep -r "profile.name\|\.name" src/lib/server/stoa/ -- should find nothing
   grep -r "StoaNameScreen" src/ -- should find nothing

3. Full new student flow — Peace path:
   - Clear stoa_profile for test user
   - Navigate to /stoa
   - Verify: Screen 1 loads — word-by-word reveal of question
   - Select "I am looking for some peace."
   - Verify: Screen 2 loads
   - Write a struggle. Submit.
   - Verify: "Carried." appears briefly
   - Verify: AUDIO starts before image (sea/birdsong in black)
   - Verify: Scene loads — morning light, garden zone, STOA near cistern
   - Verify: Cinematic camera moves toward garden position (not colonnade)
   - Verify: Beat 1 lines correct for garden path
   - Verify: Beat 3 options are the peace/garden variants
   - Select a Beat 3 option
   - Verify: Audio stance shifts within 2s
   - Verify: Beat 4 response matches selected option exactly
   - Verify: Beat 5 question appears (correct for path + choice combination)
   - Verify: Free text opens
   - Complete Beat 6
   - Verify: "The academy is open." appears slowly after response
   - Verify: HUD fades in sequentially

4. Full new student flow — Burden path:
   - Repeat above selecting "I am carrying something I can't put down."
   - Verify: Dusk light, sea terrace zone, STOA standing at terrace edge
   - Verify: Sea audio is close and prominent
   - Verify: Music is nearly absent (only faint, sparse notes)

5. Returning student flow:
   - With profile in DB (philosophyLevel set)
   - Navigate to /stoa
   - Verify: NO setup screens shown
   - Verify: Correct zone loads (same as starting path)
   - Verify: Correct light state for path
   - Verify: Returning greeting appears (correct variant for days elapsed)
   - Verify: STOA does not use any name — only "student" or no address at all
   - Verify: Free dialogue works

6. SurrealDB verification:
   SELECT * FROM stoa_profile WHERE user_id = <test user>;
   Confirm: arrival_reason, starting_path, beat3_choice, philosophy_level all populated.
   Confirm: NO name field in schema or record.

7. Report all issues. Create GitHub issues for unresolved items.
```
