# Phase 3 Build Prompts — Reasoning Quality, Desktop, World Map, Full RPG

## Prerequisites

Phase 2 must be complete and passing `pnpm check`.
Quest engine must be persisting to SurrealDB correctly.
All five shrine alcoves must be rendering.

---

## Prompt 3.1 — Reasoning quality assessment integration

**Agent: Game Logic Builder**
**Estimated scope: 3-4 files**

```
Read these files first:
- src/lib/server/stoa/game/reasoning-eval.ts (if existing — check first)
- src/lib/server/vertex.ts (READ ONLY)
- src/lib/server/engine.ts (READ ONLY — understand generateObject pattern)
- docs/modules/stoa-dialogue-agent.md (READ ONLY — see reasoning quality section)

This is DIFFERENTIATED Restormel value. Build it carefully.

Create src/lib/server/stoa/game/reasoning-eval.ts:

ReasoningEvaluator class with method:
assess(input: ReasoningAssessmentInput): Promise<ReasoningAssessment>

ReasoningAssessmentInput:
  sessionId: string
  userId: string
  turnIndex: number
  userMessage: string          — the student's message
  agentResponse: string        — STOA's full response
  frameworksReferenced: string[] — from stance detection
  conversationHistory: ConversationTurn[]

ReasoningAssessment:
  sessionId: string
  turnIndex: number
  qualityScore: number         — 0.0 to 1.0 composite
  dimensions: {
    logicalConsistency: number         — does student's reasoning follow from premises?
    frameworkApplication: number       — applied correctly, not just named?
    epistemicCalibration: number       — appropriate confidence level?
    dichotomyClarity: number | null    — null if dichotomy not used
    emotionalHonesty: number           — not suppressing emotion as Stoicism?
  }
  frameworksApplied: string[]
  improvementNotes: string[]          — for potential feedback (Phase 4)

Implementation:
- Use generateObject through vertex.ts (follow engine.ts pattern)
- Single LLM call: provide student message + agent response + history as context
- Ask model to score each dimension with brief reasoning
- Store result in stoa_reasoning_assessment via SurrealDB
- This call is ASYNC and must NOT block the dialogue SSE stream

Important constraints:
- If the student's message is under 20 words, return null (not enough signal)
- Never score negatively for emotional vulnerability — score emotionalHonesty HIGH when student is honest about pain
- Score frameworkApplication 0 if framework is named but not actually applied to their situation
- Assessment runs after the dialogue turn completes, in the background

Also create:
src/lib/server/stoa/game/reasoning-progression.ts
  getReasoningTrend(userId, lastN = 10): Promise<ReasoningTrend>
  — calculates moving average of quality scores
  — detects improvement (consecutive upward trend over 3+ sessions)
  — used to trigger the "Examined Life" meta-quest

Connect to dialogue pipeline:
In src/routes/api/stoa/dialogue/+server.ts:
After emitting 'complete' SSE event:
- Fire assessor.assess() as non-blocking Promise (do not await)
- On completion, store assessment, check if it triggers any quest conditions
- Emit 'reasoning_assessed' SSE event ONLY if meaningful (score > 0.6 for positive reinforcement)
```

---

## Prompt 3.2 — Reasoning quality UI feedback

**Agent: Dialogue Integrator**
**Estimated scope: 2-3 components**

```
Read these files first:
- src/lib/components/stoa/ (list existing)
- src/lib/server/stoa/game/reasoning-eval.ts (just created)

This is subtle UI — never make the student feel graded or judged.
Reasoning quality feedback must feel like philosophical acknowledgement, not a score.

Create src/lib/components/stoa/ReasoningAcknowledgement.svelte (Svelte 5):
- Props: { assessment: ReasoningAssessment | null }
- Only renders when assessment.qualityScore > 0.6 AND an improvement is detected
- Small, subtle, appears below the dialogue panel for 5 seconds then fades
- Text templates based on dimensions:
  - High logicalConsistency: "Your reasoning held together well there."
  - High frameworkApplication: "You are applying [framework] not just invoking it."
  - High emotionalHonesty: "There is clarity in naming what you feel."
  - Low epistemicCalibration (< 0.4): (silence — do not highlight failures)
- Style: JetBrains Mono, 12px, muted sage colour
- NEVER shows a number or percentage. Philosophy, not gamification dashboard.

Update ProgressHUD.svelte:
- Add a small trend indicator (arrow up/down/flat) next to XP
- Tooltip on hover: "Your reasoning has [improved / held steady / been inconsistent] recently"
- Do NOT show the actual score numbers anywhere in the UI

Update Quest "Examined Life" trigger:
- Wire reasoning-progression.ts to quest engine
- When trend shows consistent improvement: unlock and immediately surface the meta-quest
- STOA delivers the dialogue seed in the next conversation naturally (not as a notification)
```

---

## Prompt 3.3 — Water shader and scene polish

**Agent: Scene Architect**
**Estimated scope: 3-4 files**

```
Read these files first:
- src/lib/stoa-scene/zones/sea-terrace.ts (existing placeholder)
- src/lib/stoa-scene/zones/colonnade.ts

Replace the water placeholder in sea-terrace.ts with a real animated water shader.

Create src/lib/stoa-scene/shaders/water.glsl.ts:
Vertex shader: standard Three.js vertex with time uniform for wave animation
Fragment shader: 
  - Blend between two blue-green colours based on wave height
  - Use smoothstep for foam at wave peaks
  - Add distant horizon fade
  - Animate using time uniform (slow, calm Aegean rhythm)

Update src/lib/stoa-scene/zones/sea-terrace.ts:
  - Use ShaderMaterial with the water shader
  - Pass { uTime, uWaveHeight, uDeepColor, uShallowColor } uniforms
  - uTime updated each frame in the zone's update() method
  - uWaveHeight: 0.05 (gentle, not dramatic)
  - uDeepColor: #1E5F74 (deep Aegean blue)
  - uShallowColor: #4ECDC4 (turquoise shallow)

Also add to colonnade.ts:
  - Torch particle system: src/lib/stoa-scene/systems/particles.ts
  - Simple: 20 small spheres (SphereGeometry 0.02) per torch
  - Float upward with noise, fade out at top, respawn at base
  - Warm orange/yellow colour range
  - This is a SIMPLE particle system — no GPU instancing needed for 40 particles

Also add day/night cycle:
  src/lib/stoa-scene/systems/day-cycle.ts
  - DayCycle class with update(hour: number): void
  - hour: 0-24 (controlled by AudioEngine.setTimeOfDay)
  - Updates: sun direction + intensity, ambient light colour, sky colour, fog colour
  - Dawn (6): rose-gold light, long shadows
  - Midday (12): harsh white, short shadows
  - Evening (18): warm amber default (the academy scene default)
  - Night (22): deep blue ambient, torch light dominant
  - Smooth interpolation between states

Default scene time: 18 (golden evening) — this is the primary look.
```

---

## Prompt 3.4 — Tauri 2 desktop configuration

**Agent: Tauri Desktop Builder**
**Estimated scope: new src-tauri/ directory**

```
Check if src-tauri/ exists. If not, scaffold it.

Install Tauri CLI:
pnpm add -D @tauri-apps/cli@latest

Scaffold Tauri (if not existing):
pnpm tauri init

Configure for Stoa:
1. src-tauri/tauri.conf.json:
   - productName: "Stoa"
   - identifier: "app.allotment.stoa"
   - version: from package.json
   - window: title "Stoa — A Stoic Academy", 1440x900 min 1024x768, dark theme
   - build.beforeDevCommand: "pnpm dev"
   - build.beforeBuildCommand: "pnpm build"
   - build.devUrl: "http://localhost:5173"
   - build.frontendDist: "../build"

2. src-tauri/capabilities/default.json:
   Grant capabilities:
   - fs:read-all
   - path:all
   - shell:open
   - window:allow-set-title

3. src/lib/tauri/detection.ts:
   Export IS_TAURI boolean.
   Export getTauriVersion() async function.

4. src/lib/tauri/audio-resolver.ts:
   Export resolveAudioSrc(relativePath: string): Promise<string>
   On desktop: convertFileSrc from app data dir (see .cursor/rules/005-tauri.mdc)
   On web: return /audio/ambient/${relativePath}

5. Update src/lib/stoa-audio/ambient/howler-manager.ts:
   Import resolveAudioSrc
   In preload(): resolve each audio path using resolveAudioSrc()
   This makes audio work from disk on desktop, from server on web

6. Add to package.json scripts:
   "tauri:dev": "tauri dev"
   "tauri:build": "tauri build"

7. src-tauri/src/main.rs:
   Minimal — just run the app, no custom commands in Phase 3
   (Custom commands for file access can be added in Phase 4 if needed)

Test:
pnpm tauri:dev
Verify: Stoa loads in Tauri window, dialogue works, audio plays from web paths.
```

---

## Prompt 3.5 — World map — argument graph as navigation

**Agent: Scene Architect + Dialogue Integrator (coordinate)**
**Estimated scope: 4-5 files**

```
This is the highest-value differentiator of Phase 3.
The SOPHIA argument graph becomes a visual world map that the student navigates.

Read these files first:
- src/lib/server/retrieval.ts (READ ONLY — understand how graph is queried)
- src/lib/server/stoa/game/thinker-unlock.ts
- src/lib/stoa-scene/index.ts

Create src/lib/stoa-scene/zones/world-map.ts:
A special zone that renders SOPHIA's argument graph as a navigable constellation.

API call needed: GET /api/stoa/world-map
Returns: { nodes: WorldMapNode[], edges: WorldMapEdge[] }

WorldMapNode:
  id: string
  label: string            — framework or thinker name
  type: 'thinker' | 'framework' | 'concept'
  position: { x, y, z }   — pre-computed 3D layout
  isUnlocked: boolean
  isActive: boolean        — has the student engaged with this?

WorldMapEdge:
  from: string
  to: string
  type: 'taught' | 'supports' | 'contradicts' | 'founded'
  strength: number

Create src/routes/api/stoa/world-map/+server.ts:
  GET handler.
  Query SurrealDB: fetch thinker nodes and their relations.
  Query student progress: which thinkers are unlocked.
  Query framework exposure: which frameworks are active for this student.
  Return WorldMapNode[] and WorldMapEdge[].
  Auth required.

Scene implementation (world-map.ts):
  - Constellation layout: nodes as glowing spheres in 3D space
  - Thinkers: larger spheres (radius 0.5), copper colour when unlocked, grey when locked
  - Frameworks: medium spheres (radius 0.3), sage colour when active
  - Concepts: small spheres (radius 0.15), blue colour
  - Edges: thin lines (LineBasicMaterial), opacity based on strength
  - Locked nodes: silhouette + dim point light only
  - On hover: node pulses, label appears as sprite
  - On click: camera moves to focus on node + shows ThinkerProfile or FrameworkDetail

Student's position: a warm white sphere showing where they currently are in the graph
(placed on the most recently engaged node)

Camera: free orbit with mouse drag. Initial position: above and angled down.

Create src/lib/components/stoa/WorldMapOverlay.svelte (Svelte 5):
  Toggle via 'M' key (Map)
  Shows over scene as a mode: dims scene, shows constellation
  Shows legend: thinker, framework, concept, relationship types
  Clicking a node shows a panel: 
    - Thinker: portrait, dates, key works, unlock status
    - Framework: description, how to use, misuse warning
    - "Explore with STOA" button → opens dialogue pre-seeded with this topic
```

---

## Prompt 3.6 — Side quests and RPG depth

**Agent: Game Logic Builder**
**Estimated scope: 3-4 files**

```
Read these files first:
- src/lib/server/stoa/game/quest-definitions/ (all files)
- src/lib/server/stoa/game/quest-engine.ts

Add side quests — these are shorter, optional, can be repeated:

Create src/lib/server/stoa/game/quest-definitions/side-quests.ts:

Side Quest "daily-practice":
  Title: "The Daily Practice"
  Description: Engage with Stoa on 3 consecutive days
  Trigger: session_count minSessions 1 (always available)
  Completion: sessions on 3 different calendar days
  Reward: 75 XP
  Repeatable: true (resets weekly)

Side Quest "meditations-passage":
  Title: "A Passage from the Meditations"
  Description: Discuss one passage from Marcus Aurelius's Meditations with STOA
  Trigger: thinker_unlocked 'marcus'
  Completion: manual (STOA detects the passage was discussed)
  Reward: 50 XP
  Repeatable: false

Side Quest "challenge-your-reasoning":
  Title: "Challenge Your Reasoning"
  Description: Let STOA push back on your thinking without deflecting
  Trigger: session_count minSessions 2
  Completion: dialogue turn where stance is 'challenge' and user continues engaging (not ending session)
  Reward: 100 XP
  Repeatable: true (daily cooldown)

Side Quest "sit-with-it":
  Title: "Sit With It"
  Description: Remain in the sit_with stance for a full exchange without seeking resolution
  Trigger: session_count minSessions 3
  Completion: three consecutive turns in sit_with stance
  Reward: 125 XP
  Repeatable: false

Side Quest "stoa-at-dawn":
  Title: "Stoa at Dawn"
  Description: Begin a session before 7am
  Trigger: session_count minSessions 1
  Completion: session started between 05:00 and 07:00 local time
  Reward: 80 XP
  Repeatable: true (weekly)

Also create src/lib/server/stoa/game/level-system.ts:
  LEVEL_THRESHOLDS: number[] — [0, 300, 750, 1500, 2500, 4000, 6000, 9000, 13000, 18000]
  LEVEL_TITLES: string[] — [
    "The Seeker",          — level 1
    "The Questioner",      — level 2
    "The Practitioner",    — level 3
    "The Stoic Student",   — level 4
    "The Examined Mind",   — level 5
    "The Philosopher",     — level 6
    "The Sage in Training", — level 7
    "The Inner Citadel",   — level 8
    "The Disciple of Logos", — level 9
    "The Stoic"            — level 10
  ]
  getLevelFromXp(xp: number): { level: number, title: string, xpToNext: number }

Update ProgressHUD.svelte to use level titles instead of numbers.
```

---

## Prompt 3.7 — Final phase integration and polish

**Agent: General**
**Estimated scope: verification + polish**

```
Run complete integration check for Phase 3:

1. pnpm check — fix all TypeScript errors

2. pnpm tauri:dev — verify desktop app loads Stoa correctly

3. Test world map:
   - Press 'M' on /stoa
   - Verify constellation renders with correct unlock states
   - Click a thinker node — verify detail panel appears
   - Verify "Explore with STOA" pre-seeds the dialogue

4. Test reasoning evaluation:
   - Have a 3-turn conversation using Dichotomy of Control
   - Check SurrealDB: SELECT * FROM stoa_reasoning_assessment WHERE session_id = '[your session]'
   - Verify assessments were stored
   - Verify no blocking of dialogue stream

5. Test full quest arc:
   - Complete "Morning Intention" quest (3 journal entries)
   - Verify Garden zone becomes accessible
   - Complete "Dichotomy Test" quest (3 correct applications)
   - Verify Epictetus shrine lights up and unlock notification appears

6. Test level progression:
   - Verify XP accumulates correctly across quests
   - Verify level title updates in ProgressHUD

7. Performance check:
   - Three.js scene: check frame rate in browser DevTools
   - Target: 60fps stable on colonnade zone
   - If below 50fps: reduce shadow map size (2048→1024), check for geometry leaks

8. Audio check:
   - Verify Dorian lyre plays on scene load (after first click)
   - Change stance to 'challenge' — verify music shifts within 3 seconds
   - Mute and unmute — verify clean audio state

Document any open issues in docs/stoa/phase-3-issues.md.
Create GitHub issues for anything not resolved in this session.
```
