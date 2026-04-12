# Phase 1 Build Prompts — Stoa Immersive Foundation

## How to use these prompts

Paste each prompt into Cursor Agent (Cmd+Shift+P → "Agent") in the order listed.
Wait for each to complete and run `pnpm check` before the next.
Each prompt is self-contained and references exact file paths.

---

## Prompt 1.1 — Foundation types and shared contracts

**Agent: General (any)**
**Estimated scope: 2-3 files**

```
Read the following files before starting:
- src/lib/types/ (list all files)
- docs/modules/stoa-dialogue-agent.md

Then create src/lib/types/stoa.ts with the following TypeScript types.
DO NOT modify any existing type files.

Create these types:

1. StoaZone union type:
   'colonnade' | 'sea-terrace' | 'shrines' | 'library' | 'garden'

2. StanceType (already exists in stoa-dialogue-agent.md spec):
   'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with'

3. StoaSessionState:
   sessionId: string
   zone: StoaZone
   stance: StanceType
   isLoading: boolean
   isStreaming: boolean
   audioInitialized: boolean
   sceneReady: boolean

4. StoaDialogueTurn (matching the existing DialogueRequest/Response from the spec):
   role: 'user' | 'stoa'
   content: string
   timestamp: string
   stance?: StanceType
   frameworksReferenced?: string[]
   sourceClaims?: ClaimReference[]

5. ClaimReference (from existing spec):
   claimId: string
   sourceText: string
   sourceAuthor: string
   sourceWork: string
   relevanceScore: number

6. StoaProgressState (for Phase 2 game layer — define now, use later):
   xp: number
   level: number
   unlockedThinkers: string[]
   masteredFrameworks: string[]
   activeQuestIds: string[]
   completedQuestIds: string[]

7. ThinkerProfile:
   id: string
   name: string
   dates: string
   zone: StoaZone
   isUnlocked: boolean
   spritePath: string
   voiceSignature: string

Export all types. No default export.
```

---

## Prompt 1.2 — Stoa SurrealDB schema extension

**Agent: Game Logic Builder**
**Estimated scope: 1 new file**

```
Read these files first:
- scripts/setup-schema.ts (READ ONLY — understand existing patterns)
- src/lib/types/stoa.ts (just created)

Create scripts/setup-stoa-schema.ts with:

1. A comment block at the top: "Stoa immersive schema extension. Run after setup-schema.ts. Do not merge into setup-schema.ts."

2. SurrealDB table definitions for:
   - stoa_student_progress (as specified in .cursor/rules/003-stoa-game.mdc)
   - stoa_quest_completion
   - stoa_reasoning_assessment
   - stoa_framework_exposure

3. A main() async function that connects to SurrealDB using the same pattern as setup-schema.ts, runs all DEFINE statements, and logs success per table.

4. Add to package.json scripts:
   "db:stoa-schema": "tsx --env-file=.env scripts/setup-stoa-schema.ts"

Follow the EXACT same connection and error handling pattern as setup-schema.ts.
DO NOT import from or modify setup-schema.ts.
```

---

## Prompt 1.3 — Three.js scene module scaffold

**Agent: Scene Architect**
**Estimated scope: 8-10 files**

```
Read these files first:
- src/lib/types/stoa.ts
- .cursor/rules/001-stoa-scene.mdc
- package.json (check if three is already installed)

Install Three.js if not present:
pnpm add three
pnpm add -D @types/three

Then create the following file structure under src/lib/stoa-scene/:

1. src/lib/stoa-scene/index.ts
   - StoaScene class (as specified in .cursor/skills/stoa-scene-builder.md)
   - Constructor takes HTMLCanvasElement
   - Methods: loadZone(zone: StoaZone), resize(w, h), start(), destroy()
   - Internal: WebGLRenderer with ACESFilmic tone mapping, PCFSoft shadows
   - ZoneManager instantiation (stub — ZoneManager created next)

2. src/lib/stoa-scene/zones/index.ts
   - ZoneManager class
   - Methods: transition(zone: StoaZone): Promise<void>, update(): void, dispose(): void
   - Internal: Map of zone name to THREE.Group
   - Smooth fade transition between zones (opacity tween using clock + lerp)
   - update() calls the active zone's per-frame update if it exists

3. src/lib/stoa-scene/zones/colonnade.ts
   - buildColonnade(): Promise<THREE.Group>
   - Floor: PlaneGeometry, MeshStandardMaterial, marble-like (#E8E0D0, roughness 0.3)
   - Column placeholders: 8 CylinderGeometry instances, cream/marble color
   - STOA placeholder: BoxGeometry 0.5x2x0.2 at position (0, 1, -5), warm white
   - Sun DirectionalLight (#FFD4A0, intensity 1.4) with shadow
   - AmbientLight (#87CEEB, 0.3)
   - Two PointLights for torch positions (warm orange, intensity 2, distance 8)
   - Returns the group. Adds dispose() method to group.userData

4. src/lib/stoa-scene/zones/sea-terrace.ts
   - buildSeaTerrace(): Promise<THREE.Group>
   - Flat plane for water (PlaneGeometry 40x40, animated via uniforms)
   - Simple sky color (scene background, #87CEEB fading to #E8D5B0 at horizon)
   - Placeholder: no actual water shader yet — just a blue-green PlaneGeometry
   - Note in comments: "Water shader: Phase 1.6"

5. src/lib/stoa-scene/camera/controller.ts
   - CameraController class
   - Method: transitionTo(position: THREE.Vector3, lookAt: THREE.Vector3, duration: number): Promise<void>
   - Uses THREE.Clock for delta-based lerp (no GSAP dependency yet)
   - Gentle breathing: subtle sin wave on camera Y position (amplitude 0.02, frequency 0.5)
   - Method: update(delta: number): void — call this in render loop

6. src/lib/stoa-scene/objects/columns.ts
   - columns({ count, spacing, height }): THREE.InstancedMesh
   - Use THREE.InstancedMesh for performance
   - CylinderGeometry(0.3, 0.4, height, 8) — simple Doric proportions
   - MeshStandardMaterial, color '#E8E0D0', roughness 0.4
   - Position: two rows of count/2 columns, spacing apart
   - Each instance casts and receives shadows

7. src/lib/stoa-scene/objects/stoa-sprite.ts
   - createStoaSprite(imagePath: string): Promise<THREE.Sprite>
   - Loads texture via THREE.TextureLoader
   - THREE.SpriteMaterial with the loaded texture
   - Default size: 1.5 wide, 3 tall (scale the sprite)
   - sprite.center.set(0.5, 0) — grounded, not floating
   - Returns sprite ready to add to scene

All files must be fully typed TypeScript.
No global state.
Every class/object with geometries must expose a dispose() method or add one to userData.
```

---

## Prompt 1.4 — Audio engine scaffold

**Agent: Audio Engineer**
**Estimated scope: 6-8 files**

```
Read these files first:
- src/lib/types/stoa.ts
- .cursor/rules/002-stoa-audio.mdc
- package.json

Install audio dependencies:
pnpm add howler tone
pnpm add -D @types/howler

Create the following under src/lib/stoa-audio/:

1. src/lib/stoa-audio/ambient/sound-manifest.ts
   Export SOUND_MANIFEST as specified in .cursor/rules/002-stoa-audio.mdc.
   Use the exact structure from the rules file.
   Paths reference /audio/ambient/ (files will be added to /static/ later).

2. src/lib/stoa-audio/generative/scales.ts
   Export D_DORIAN string array.
   Export STANCE_MUSIC_PARAMS object as specified in .cursor/rules/002-stoa-audio.mdc.
   Export LYRE_SYNTH_CONFIG and REVERB_CONFIG constants.

3. src/lib/stoa-audio/generative/tone-engine.ts
   ToneEngine class as specified in .cursor/skills/stoa-audio-builder.md.
   Methods: init(), setStance(stance), setAtmosphere(hour), fadeIn(duration), fadeOut(duration), destroy().
   Dorian lyre synthesis with Tone.js.
   Stance-reactive music via rampTo() — never direct assignment.

4. src/lib/stoa-audio/ambient/howler-manager.ts
   HowlerManager class.
   Methods: preload(): Promise<void>, setZone(zone): void, setTimeOfDay(hour): void, 
            fadeIn(duration): void, fadeOut(duration): void, destroy(): void.
   Manages Howl instances for each sound in SOUND_MANIFEST.
   Random birdsong trigger with setInterval using random delay within min/max range.
   Zone changes adjust spatial audio positions.

5. src/lib/stoa-audio/systems/mood-reactor.ts
   MoodReactor class.
   Constructor: (howler: HowlerManager, tone: ToneEngine)
   Method: setStance(stance: StanceType): void
   Calls both howler and tone updates on stance change.
   Logs stance transitions for debugging.

6. src/lib/stoa-audio/index.ts
   AudioEngine class as specified in .cursor/skills/stoa-audio-builder.md.
   Export getAudioEngine() singleton.
   Export AudioEngine class.

All files fully typed TypeScript.
All Tone.js nodes disposed in destroy() methods.
```

---

## Prompt 1.5 — Svelte UI scaffold

**Agent: Dialogue Integrator**
**Estimated scope: 8-10 files**

```
Read these files first:
- src/lib/types/stoa.ts
- src/routes/+layout.svelte (understand existing layout)
- src/lib/components/ (list to understand naming conventions)
- .cursor/rules/004-stoa-ui.mdc

DO NOT modify any existing route or layout files.

Create a new SvelteKit route for Stoa at src/routes/stoa/:

1. src/routes/stoa/+page.svelte
   - Imports StoaApp component
   - Full viewport, no scroll, dark background #1A1917
   - No top bar or nav (Stoa is its own world)

2. src/routes/stoa/+page.server.ts
   - Load function: check auth (use existing auth pattern)
   - Return: { userId, sessionId (generate uuid) }

3. src/lib/components/stoa/StoaApp.svelte (Svelte 5)
   - Props: { userId: string, sessionId: string }
   - Mounts SceneCanvas and DialogueOverlay
   - Manages: zone state, audio init on first click
   - Uses $state for: currentZone, currentStance, audioReady
   - On first user click anywhere: call audioEngine.init()

4. src/lib/components/stoa/SceneCanvas.svelte (Svelte 5)
   - Binds canvas element
   - onMount: create StoaScene, call start()
   - onDestroy: call scene.destroy()
   - ResizeObserver: call scene.resize() on container size change
   - Emits: 'sceneReady' event when Three.js is running

5. src/lib/components/stoa/DialogueOverlay.svelte (Svelte 5)
   - Props: { stance: StanceType, sessionId: string }
   - Floating parchment panel (CSS as per .cursor/rules/004-stoa-ui.mdc spec)
   - Textarea input for user message
   - Streaming text display for STOA's response (character-by-character)
   - Submit on Enter (not Shift+Enter), send on button click
   - Shows stance label (JetBrains Mono, 11px, copper)
   - Shows source citations below response
   - Emits: 'stanceChange' event when stance changes in response

6. src/lib/components/stoa/StanceIndicator.svelte (Svelte 5)
   - Props: { stance: StanceType }
   - Five small circles, one lit per stance
   - Colours: hold=sage, challenge=copper, guide=blue, teach=teal, sit_with=dim-white
   - Bottom-left of screen, fixed position
   - 400ms opacity transition between stances

7. src/lib/components/stoa/AudioControls.svelte (Svelte 5)
   - Props: { audioReady: boolean }
   - Mute toggle button
   - Volume slider (0-1)
   - Fixed position top-right of scene
   - Minimal styling — does not compete with scene

8. src/lib/stores/stoa-session.svelte.ts
   - Svelte 5 runes-based store
   - $state: StoaSessionState
   - Exported reactive getters and setters
   - Persists sessionId to sessionStorage

Use Cormorant Garamond for STOA's words.
Use JetBrains Mono for UI chrome / metadata.
DO NOT use Tailwind for Stoa components — use scoped CSS with custom properties.
```

---

## Prompt 1.6 — Dialogue API route integration

**Agent: Dialogue Integrator**
**Estimated scope: 2-3 files**

```
Read these files before starting:
- src/routes/api/analyse/+server.ts (READ ONLY — SSE pattern reference)
- src/lib/server/stoa/ (list all files — understand existing Stoa backend)
- docs/modules/stoa-dialogue-agent.md (READ ONLY)
- src/lib/server/vertex.ts (READ ONLY)

The existing Stoa dialogue endpoint may already exist at src/routes/api/stoa/dialogue/+server.ts.
If it exists: read it, then wire it to the UI (skip to step 3).
If it does not exist: create it.

1. If creating: src/routes/api/stoa/dialogue/+server.ts
   Follow the EXACT same SSE streaming pattern as src/routes/api/analyse/+server.ts.
   Route all LLM calls through vertex.ts — never create new provider clients.
   Use retrieval.ts for Stoic claim retrieval.
   Accept: { message: string, sessionId: string, history: ConversationTurn[] }
   Emit SSE events: start, delta, stance, metadata, complete, error
   The 'stance' event carries: { stance: StanceType, frameworksReferenced: string[] }

2. src/lib/server/stoa/stance.ts (if not existing)
   Basic stance detection function.
   Input: (message: string, history: ConversationTurn[], agentResponse: string)
   Output: StanceType
   v1: rule-based heuristics (not ML). Key signals:
   - sit_with: distress keywords + short user messages
   - challenge: contradictions, weak reasoning, avoidance patterns
   - guide: practical questions, what-should-I-do framing
   - teach: direct requests for framework explanation
   - hold: default / unclear / neutral

3. Update src/lib/components/stoa/DialogueOverlay.svelte
   Wire to /api/stoa/dialogue via EventSource / fetch with streaming.
   On 'delta' event: append text character-by-character to display.
   On 'stance' event: emit 'stanceChange' to parent, which updates StanceIndicator and AudioEngine.
   On 'complete' event: re-enable input, save turn to session store.

DO NOT modify vertex.ts, retrieval.ts, or any existing server file.
```

---

## Prompt 1.7 — Audio asset acquisition scripts

**Agent: Asset Pipeline Manager**
**Estimated scope: 2 scripts + asset docs**

```
Read these files first:
- .cursor/rules/002-stoa-audio.mdc (SOUND_MANIFEST section)
- scripts/ (list existing scripts for naming conventions)

Create:

1. scripts/stoa-assets/fetch-audio-assets.sh
   A shell script that documents WHERE to get each audio asset.
   For each sound in SOUND_MANIFEST, produce:
   - The recommended source URL (freesound.org search or specific pack)
   - The license requirement (CC0 preferred, CC BY acceptable)
   - The target path in /static/audio/ambient/
   - The ffmpeg command to convert to MP3 128kbps and trim to a clean loop point
   
   Do NOT actually download anything — produce the script as a guide.
   Use freesound.org for: waves, birdsong, wind, torch crackle.
   Recommended search terms: "aegean waves loop", "swift bird call", "wind columns ambiance", "fire crackle loop"

2. scripts/stoa-assets/asset-manifest.json
   A JSON manifest of all required assets:
   {
     "assets": [
       {
         "id": "aegean-waves-loop",
         "type": "audio",
         "targetPath": "static/audio/ambient/aegean-waves-loop.mp3",
         "sourceSuggestion": "freesound.org search: 'waves loop calm'",
         "license": "CC0",
         "maxSizeKB": 1500,
         "loopable": true,
         "acquired": false
       }
     ]
   }
   Include ALL assets: audio files, HDRI (Mediterranean sky from Poly Haven), STOA sprite PNG.

3. scripts/stoa-assets/fetch-hdri.sh
   Shell script to download a Mediterranean HDRI from Poly Haven API.
   Use the Poly Haven API: https://api.polyhaven.com/assets?t=hdris
   Target: kloofendal_48d_partly_cloudy (or similar outdoor warm scene)
   Download the 2K HDR version.
   Target path: static/hdri/mediterranean-sky.hdr
   Convert to .exr if needed using ImageMagick.
   Document the CC0 license.

4. docs/stoa/asset-guide.md
   Document all assets, their sources, licenses, and acquisition status.
   Table format: Asset ID | Type | Source | License | Status | Path
```

---

## Prompt 1.8 — Phase 1 integration test and smoke check

**Agent: General**
**Estimated scope: verification only**

```
Run the following checks and fix any issues:

1. pnpm check
   Fix all TypeScript errors in stoa-related files.
   DO NOT fix pre-existing errors in non-stoa files.

2. Verify the following imports resolve correctly:
   - import { StoaScene } from '$lib/stoa-scene'
   - import { AudioEngine } from '$lib/stoa-audio'
   - import type { StoaZone, StanceType } from '$lib/types/stoa'

3. Verify src/routes/stoa/+page.svelte renders without errors:
   pnpm dev
   Navigate to http://localhost:5173/stoa
   Expected: dark background renders, no console errors for missing assets
   (Three.js scene may be empty at this point — that is acceptable)

4. Verify src/routes/api/stoa/dialogue/+server.ts responds:
   curl -X POST http://localhost:5173/api/stoa/dialogue \
     -H "Content-Type: application/json" \
     -d '{"message": "test", "sessionId": "test-123", "history": []}'
   Expected: SSE stream starts, emits 'start' event, does not crash

5. Report:
   - Which files were created
   - Which files had errors and what was fixed
   - Any deviations from the plan with justification
   - What remains for Phase 2
```
