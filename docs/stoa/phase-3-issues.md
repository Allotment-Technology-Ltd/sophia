# Phase 3 Integration Open Issues

Date: 2026-03-30
Scope: Prompt 3.7 verification run in `/stoa_game/phase-3-rpg-desktop.md`

## Verified Blockers and Open Items

### 1) Dialogue stream is not fully non-blocking after `complete`
- **Area:** `src/routes/api/stoa/dialogue/+server.ts`
- **Evidence:** The route emits `type: "complete"` and then waits to close SSE until both background evaluations settle:
  - `baselineQuestEvaluation = runQuestEvaluation(...)`
  - `reasoningAssessmentEvaluation = runReasoningAssessment()`
  - `Promise.allSettled([...]).finally(() => controller.close())`
- **Impact:** UI keeps `isStreaming` true until stream closure; this can delay user ability to send a new turn when reasoning evaluation is slow.
- **Expected by prompt:** Reasoning assessment should run in background and **must NOT block** dialogue stream.
- **Status:** Open.

### 2) World-map and dialogue E2E are auth-blocked in local validation path
- **Area:** `/api/stoa/world-map`, `/api/stoa/dialogue`, `/api/stoa/progress`, local `/stoa` route.
- **Evidence:**
  - `curl -i http://127.0.0.1:4173/api/stoa/world-map` returns `401 Authentication required`.
  - `curl -i -X POST http://127.0.0.1:4173/api/stoa/dialogue ...` returns `401 Authentication required`.
  - Browser console on `/stoa`: `VITE_NEON_AUTH_URL is missing; Neon Auth client cannot start.`
- **Impact:** Prompt-required functional checks (node detail interaction, explore pre-seed, reasoning persistence query path) cannot be completed in this environment without Neon Auth JWT/config.
- **Expected by prompt:** Full interaction checks on `/stoa`.
- **Status:** Open (environment + dev-experience gap).

### 3) Tauri desktop validation blocked by missing Rust toolchain
- **Area:** `pnpm tauri:dev` runtime environment.
- **Evidence:** Command fails immediately with `failed to run 'cargo metadata' ... No such file or directory (os error 2)`.
- **Impact:** Desktop runtime checks cannot be executed in this session.
- **Expected by prompt:** Verify desktop app loads and behaves correctly.
- **Status:** Open (environment precondition not met).

### 4) Performance target remains unverified (static risk only)
- **Area:** Three.js runtime FPS in colonnade/world-map.
- **Evidence:** No live FPS tooling available in this run due blocked interactive auth path; static review shows `sun.shadow.mapSize.set(2048, 2048)` in `colonnade` plus world-map dynamic raycasting/labels.
- **Impact:** The `60fps stable` target from prompt is not empirically confirmed.
- **Expected by prompt:** DevTools FPS sanity check with threshold handling.
- **Status:** Open (needs profiled run).

## GitHub Tracking

- https://github.com/Allotment-Technology-Ltd/sophia/issues/106
- https://github.com/Allotment-Technology-Ltd/sophia/issues/107
- https://github.com/Allotment-Technology-Ltd/sophia/issues/108
- https://github.com/Allotment-Technology-Ltd/sophia/issues/109
