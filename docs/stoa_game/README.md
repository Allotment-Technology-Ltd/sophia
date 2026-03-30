# Stoa Immersive — Cursor Setup Master Guide

## What is in this package

Everything needed to orchestrate a multi-agent Cursor build of the Stoa immersive experience.

```
sophia/
  .cursor/
    rules/
      000-agent-protocol.mdc   ← Always-apply rule for ALL agents
      001-stoa-scene.mdc       ← Three.js scene architecture rules
      002-stoa-audio.mdc       ← Audio engine rules
      003-stoa-game.mdc        ← Game logic and quest system rules
      004-stoa-ui.mdc          ← Svelte UI overlay rules
      005-tauri.mdc            ← Tauri 2 desktop rules
    skills/
      stoa-scene-builder.md    ← Scene construction patterns and reference code
      stoa-audio-builder.md    ← Audio engine patterns and reference code
      mcp-recommendations.md   ← MCP server setup and full .cursor/mcp.json
      agent-configs.md         ← 6 named agent configurations with system prompts

  docs/stoa_game/
    phase-1-foundation.md      ← 8 prompts: types, schema, Three.js, audio, UI, API
    phase-2-game-logic.md      ← 7 prompts: quest engine, shrines, journal, unlocks
    phase-3-rpg-desktop.md     ← 7 prompts: reasoning eval, Tauri, world map, RPG
```

---

## Setup sequence (do this before any build prompts)

### Step 1: Install Cursor rules

Ensure these Stoa rules exist in your repo at `.cursor/rules/`:

```bash
ls .cursor/rules/000-agent-protocol.mdc \
   .cursor/rules/001-stoa-scene.mdc \
   .cursor/rules/002-stoa-audio.mdc \
   .cursor/rules/003-stoa-game.mdc \
   .cursor/rules/004-stoa-ui.mdc \
   .cursor/rules/005-tauri.mdc
```

### Step 2: Install Cursor skills

Ensure the Stoa skills exist in `.cursor/skills/`:

```bash
ls .cursor/skills/stoa-scene-builder.md \
   .cursor/skills/stoa-audio-builder.md \
   .cursor/skills/mcp-recommendations.md \
   .cursor/skills/agent-configs.md
```

### Step 3: Configure MCPs

Follow `.cursor/skills/mcp-recommendations.md`.
Create `.cursor/mcp.json` at your repo root with the recommended configuration.
Add `RESTORMEL_GATEWAY_KEY` and `GITHUB_PAT` to your environment.

### Step 4: Register agents (if Cursor supports named agent configs)

Copy agent config definitions from `.cursor/skills/agent-configs.md` and create:
`.cursor/agents/scene-architect.json`
`.cursor/agents/audio-engineer.json`
`.cursor/agents/dialogue-integrator.json`
`.cursor/agents/game-logic-builder.json`
`.cursor/agents/tauri-builder.json`
`.cursor/agents/asset-pipeline.json`

### Step 5: Verify setup

Open Cursor in your SOPHIA repo.
In Agent mode, ask: "List the Cursor rules available in this repo."
You should see the 6 Stoa rules listed.

Then validate Restormel runtime setup:

```bash
pnpm restormel:setup:status
pnpm smoke:restormel:mcp
```

Agent automation note: this preflight is required for any Restormel/AAIF-scoped agent task. See `docs/restormel-integration/quickstart-mcp-aaif.md`.

---

## Build execution order

### Phase 1 — Foundation (estimated: 2-4 days AI-assisted)
Run prompts 1.1 → 1.8 in order from `docs/stoa_game/phase-1-foundation.md`.
Each prompt must pass `pnpm check` before the next starts.

**Deliverable:** Stoa loads at /stoa, 3D colonnade renders, dialogue works, audio plays.

### Phase 2 — Quest system (estimated: 2-3 days)
Run prompts 2.1 → 2.7 in order from `docs/stoa_game/phase-2-game-logic.md`.
Requires Phase 1 complete.

**Prompt 2.1 (SurrealDB):** start a local SurrealDB instance (default `http://localhost:8000/rpc`) before `pnpm db:stoa-schema`. In Cursor worktrees without a copied `.env`, set `SURREAL_URL` / `SURREAL_*` in the shell or symlink `.env` from your main clone.

**Deliverable:** Quest journal works, thinker shrines unlock, XP accumulates.

### Phase 3 — RPG + Desktop (estimated: 3-4 days)
Run prompts 3.1 → 3.7 in order from `docs/stoa_game/phase-3-rpg-desktop.md`.
Requires Phase 2 complete.

**Deliverable:** Reasoning quality as progression, Tauri desktop app, argument graph world map, full RPG arc.

---

## Key decisions baked into this setup

| Decision | Rationale |
|---|---|
| Three.js (not Unreal) | Solo-buildable, web-native, stylised > photorealistic for this product |
| Tauri 2 (not Electron) | Better performance, same codebase, native feel |
| Tone.js generative music | Unique — no competitor has stance-reactive Ancient Greek music |
| Illustrated STOA sprite | Avoids uncanny valley, achievable with AI tools |
| SurrealDB for game state | Already in stack, graph-native, fits thinker relations |
| Reasoning quality as XP | DIFFERENTIATED — no other product does this |
| Argument graph as world map | DIFFERENTIATED — SOPHIA's graph becomes the gameplay |

## Agent coordination note

Never run two agents on the same file simultaneously.
After each agent completes: `git commit` with clear message.
Next agent reads committed state before starting.

## Restormel platform connection

Phase 3's reasoning quality evaluation is where Restormel evaluation primitives enter gameplay.
The `stoa_reasoning_assessment` table is the data source for future Restormel dashboards.
If Restormel gains a reasoning quality API, swap `reasoning-eval.ts` to call it externally.
The interface is already designed for this swap.
