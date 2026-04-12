# Phase 2 Build Prompts — Stoa Quest System and Thinker Unlocks

## Prerequisites

Phase 1 must be complete and passing `pnpm check` before starting Phase 2.
The dialogue API must be returning SSE events correctly.

---

## Prompt 2.1 — SurrealDB game schema deployment

**Agent: Game Logic Builder**
**Estimated scope: 1 file + verification**

```
Read these files first:
- scripts/setup-stoa-schema.ts (should exist from Phase 1)
- scripts/setup-schema.ts (READ ONLY — connection pattern reference)

Run the schema script against your local SurrealDB:
pnpm db:stoa-schema

If it fails, fix the errors. Common issues:
- SurrealDB version differences in DEFINE FIELD syntax
- TYPE RELATION syntax — use TYPE record<tablename> for foreign key references
- DEFAULT time::now() may need to be time::now() not now()

After running successfully, verify these tables exist:
- stoa_student_progress
- stoa_quest_completion
- stoa_reasoning_assessment
- stoa_framework_exposure

Report the exact SurrealDB version and any syntax adjustments made.
```

---

## Prompt 2.2 — Quest engine core

**Agent: Game Logic Builder**
**Estimated scope: 6-8 files**

```
Read these files first:
- src/lib/types/stoa.ts
- .cursor/rules/003-stoa-game.mdc
- scripts/setup-stoa-schema.ts (understand schema)

Create the quest engine under src/lib/server/stoa/game/:

1. src/lib/server/stoa/game/quest-definitions/index.ts
   Quest registry — exports ALL_QUESTS as QuestDefinition[]
   For now, imports from marcus.ts, epictetus.ts, seneca.ts, meta.ts

2. src/lib/server/stoa/game/quest-definitions/marcus.ts
   Three quests for the Marcus Aurelius arc:
   
   Quest "view-from-above":
   - Title: "The View from Above"
   - Framework: negative_visualisation + cosmic_perspective
   - Trigger: session_count minSessions 2 (available from session 2)
   - Completion: framework_used 'cosmic_perspective' minCount 1 in distinct real situations
   - Reward: 150 XP
   - Dialogue seed: "There is a practice Marcus returned to often. Look at your situation from above — from a great height. What remains significant?"
   
   Quest "morning-intention":
   - Title: "The Morning Intention"
   - Framework: morning_preparation
   - Trigger: manual (STOA offers after first session)
   - Completion: journal_entries minCount 3 (three morning preparation entries)
   - Reward: 100 XP
   - Unlock: no new thinker — but unlocks the Garden zone
   
   Quest "examined-week":
   - Title: "The Examined Week"
   - Framework: evening_reflection
   - Trigger: thinker_unlocked 'marcus'
   - Completion: days_elapsed 7 from quest start + journal_entries 5
   - Reward: 200 XP

3. src/lib/server/stoa/game/quest-definitions/epictetus.ts
   Two quests:
   
   Quest "dichotomy-test":
   - Title: "The Dichotomy Test"
   - Framework: dichotomy_of_control
   - Trigger: session_count minSessions 3
   - Completion: framework_used 'dichotomy_of_control' minCount 3 (correctly applied)
   - Reward: 175 XP, Unlock: 'epictetus'
   
   Quest "epictetus-door":
   - Title: "Epictetus's Door"
   - Trigger: thinker_unlocked 'epictetus'
   - Completion: session_count minSessions 2 WITH epictetus voice active
   - Reward: 150 XP

4. src/lib/server/stoa/game/quest-definitions/seneca.ts
   Two quests:
   
   Quest "seneca-letters":
   - Title: "Seneca's Letters"
   - Trigger: thinker_unlocked 'epictetus'
   - Completion: journal_entries minCount 4 using different frameworks each time
   - Reward: 250 XP, Unlock: 'seneca'
   
   Quest "time-is-short":
   - Title: "Time Is Short"
   - Framework: memento_mori
   - Trigger: thinker_unlocked 'seneca'
   - Completion: framework_used 'memento_mori' minCount 2
   - Reward: 175 XP

5. src/lib/server/stoa/game/quest-definitions/meta.ts
   One meta-quest:
   
   Quest "examined-life":
   - Title: "The Examined Life"
   - Trigger: reasoning_score minScore 0.65
   - Completion: reasoning_score minScore 0.75 (improvement verified)
   - Reward: 500 XP, Unlock: 'zeno'
   - Dialogue seed: "Something has shifted in how you reason. You are no longer just using the frameworks — you are thinking with them."

6. src/lib/server/stoa/game/progress-store.ts
   Server-side SurrealDB read/write for student progress.
   Functions (all async, all take userId: string):
   - getProgress(userId): Promise<StoaProgressState>
   - addXp(userId, amount): Promise<StoaProgressState>
   - unlockThinker(userId, thinkerId): Promise<void>
   - masterFramework(userId, frameworkId): Promise<void>
   - startQuest(userId, questId): Promise<void>
   - completeQuest(userId, questId, sessionIds: string[]): Promise<void>
   Use the existing SurrealDB connection pattern from the codebase.

7. src/lib/server/stoa/game/quest-engine.ts
   QuestEngine class (stateless, operates on SurrealDB state):
   - evaluateTriggers(userId, context): Promise<QuestDefinition[]> — returns newly available quests
   - evaluateCompletions(userId, context): Promise<QuestDefinition[]> — returns newly completed quests
   - awardCompletion(userId, quest): Promise<void> — awards XP, unlocks, logs
   QuestContext type: { sessionId, frameworksUsed, reasoningScore, daysElapsed, journalCount }
   Idempotent: calling evaluateCompletions twice cannot double-award.

8. src/lib/server/stoa/game/thinker-unlock.ts
   THINKER_REGISTRY: ThinkerProfile[] — all five thinkers with unlock conditions
   isUnlocked(userId, thinkerId): Promise<boolean>
   getUnlockedThinkers(userId): Promise<ThinkerProfile[]>
   Default unlocked on first session: 'marcus'
```

---

## Prompt 2.3 — Quest evaluation in dialogue pipeline

**Agent: Dialogue Integrator**
**Estimated scope: 2-3 file modifications**

```
Read these files first:
- src/routes/api/stoa/dialogue/+server.ts (existing)
- src/lib/server/stoa/game/quest-engine.ts (just created)
- src/lib/server/stoa/game/progress-store.ts (just created)

Modify src/routes/api/stoa/dialogue/+server.ts to add post-response quest evaluation.
DO NOT break the existing SSE streaming — quest evaluation is async and non-blocking.

After the SSE 'complete' event is emitted:
1. Call questEngine.evaluateCompletions(userId, context) — ASYNC, do not await in stream
2. For each completed quest: call questEngine.awardCompletion()
3. For each newly available quest: store in SurrealDB for next session display
4. Log results to cloud logger (do not surface errors to the SSE stream)

Also add a new SSE event type: 'progress_update':
{ xpGained: number, newUnlocks: string[], questsCompleted: string[] }
Emit this after quest evaluation completes.

Add new endpoint: GET /api/stoa/progress
Returns current StoaProgressState for the authenticated user.

DO NOT modify the core SSE streaming logic.
DO NOT make quest evaluation block the dialogue response.
```

---

## Prompt 2.4 — Shrine alcoves in Three.js scene

**Agent: Scene Architect**
**Estimated scope: 3-4 files**

```
Read these files first:
- src/lib/stoa-scene/zones/colonnade.ts
- src/lib/stoa-scene/zones/index.ts (ZoneManager)
- src/lib/types/stoa.ts
- src/lib/server/stoa/game/thinker-unlock.ts

Create src/lib/stoa-scene/zones/shrines.ts:

The shrines zone is a separate alcove area adjoining the colonnade.
It contains 5 alcoves, one per Stoic thinker.

buildShrines(unlockedThinkers: string[]): Promise<THREE.Group>

For each thinker (marcus, epictetus, seneca, chrysippus, zeno):
- Create an alcove: a shallow curved recess (use BoxGeometry or custom geometry)
- Inside: a plinth (BoxGeometry, marble material)
- On plinth: a STOA sprite (the thinker's portrait, if unlocked) OR a silhouette (if locked)
- Above: a small hanging oil lamp (SphereGeometry + PointLight, warm amber)
- A nameplate: use THREE.Sprite with canvas-rendered text, or simple BoxGeometry placeholder

Locked alcoves:
- Silhouette sprite: grey, semi-transparent
- Nameplate: shows "???" 
- Oil lamp: not lit

Unlocked alcoves:
- Full colour portrait sprite
- Real name on nameplate
- Lamp lit (PointLight on)

Each alcove has userData.thinkerId set for click detection.
Clicking an unlocked alcove emits a custom event: 'thinkerSelected' with thinkerId.

Update ZoneManager to handle 'shrines' zone.
Pass current unlockedThinkers array when building shrines zone.
```

---

## Prompt 2.5 — Quest Journal UI

**Agent: Dialogue Integrator**
**Estimated scope: 3-4 Svelte components**

```
Read these files first:
- src/lib/components/stoa/ (list current components)
- src/lib/types/stoa.ts
- .cursor/rules/004-stoa-ui.mdc

Create:

1. src/lib/components/stoa/QuestJournal.svelte (Svelte 5)
   - Props: { open: boolean, userId: string }
   - Full-screen overlay (position: fixed, z-index: 100)
   - Background: rgba(20, 18, 16, 0.95)
   - Loads quest data from /api/stoa/progress on open
   - Shows three sections: "Active Quests", "Available Quests", "Completed Quests"
   - Each quest rendered as QuestCard component
   - Close: Escape key, or X button in corner
   - Open/close transition: fade (300ms)

2. src/lib/components/stoa/QuestCard.svelte (Svelte 5)
   - Props: { quest: QuestDefinition, status: 'active' | 'available' | 'completed' | 'locked' }
   - Active: warm amber border, full description visible
   - Available: neutral border, shows dialogue seed quote
   - Completed: dimmed, shows completion date, XP awarded, small checkmark
   - Locked: greyed out, title replaced with "···" for mystery

3. src/lib/components/stoa/ProgressHUD.svelte (Svelte 5)
   - Props: { progress: StoaProgressState }
   - Minimal — bottom-right of screen
   - XP number in JetBrains Mono (e.g. "847 XP")
   - Level shown as "The Questioner" (level 1), "The Practitioner" (level 2), etc.
   - Tiny progress bar to next level
   - Click opens QuestJournal

4. Update StoaApp.svelte:
   - Add QuestJournal, ProgressHUD to layout
   - Wire 'J' key to toggle journal
   - Load progress from /api/stoa/progress on mount
   - Listen for 'progress_update' SSE events from dialogue to refresh progress
```

---

## Prompt 2.6 — Thinker unlock notification

**Agent: Dialogue Integrator**
**Estimated scope: 2 files**

```
Read these files first:
- src/lib/components/stoa/StoaApp.svelte
- src/lib/components/stoa/DialogueOverlay.svelte

Create src/lib/components/stoa/ThinkerUnlockNotification.svelte (Svelte 5):

- Props: { thinker: ThinkerProfile | null }
- When thinker is not null: animate in from top of screen
- Shows: thinker portrait (small, 80px), name, unlock message
- Message template: "The shrine of [Name] is now open to you."
- Duration: 4 seconds, then fade out
- Position: top-centre, z-index: 200
- Style: parchment background, copper border, Cormorant Garamond font
- Also triggers a Three.js event: illuminate the corresponding shrine alcove

Update StoaApp.svelte:
- On 'progress_update' SSE event, check for newUnlocks
- For each unlock: show ThinkerUnlockNotification
- Queue notifications if multiple (show one at a time)
- Emit event to SceneCanvas to update shrine lighting for newly unlocked thinker
```

---

## Prompt 2.7 — Phase 2 integration check

**Agent: General**
**Estimated scope: verification**

```
Run full check and verify Phase 2 integration:

1. pnpm check — fix any TypeScript errors in stoa files only

2. Verify quest engine idempotency:
   - Manually call questEngine.evaluateCompletions() twice for a test user
   - Confirm XP is only awarded once

3. Verify shrine zone loads:
   - Navigate to /stoa
   - Use browser console: stoaScene.loadZone('shrines')
   - Confirm 5 alcoves render (marcus lit, others dark)

4. Verify quest journal:
   - Press 'J' key on /stoa
   - Confirm journal opens with at least one available quest ("Morning Intention")

5. Verify progress API:
   curl http://localhost:5173/api/stoa/progress \
     -H "Cookie: [your auth cookie]"
   Expected: { xp: 0, level: 1, unlockedThinkers: ['marcus'], ... }

6. Report all deviations from plan with justification.
```
