# Ten-minute dashboard experience (narrow scope first)

**Intent:** Most users should reach a working path without reading forensic UI or choosing from dozens of models. Advanced and power-user surfaces exist from day one but are **secondary**—behind explicit navigation, not in the default path.

This applies to **Sophia’s operator admin** and aligns with how **Restormel Keys** projects should feel: a short questionnaire → a **small** set of presets → done.

---

## Principles

1. **Default path = 3–5 decisions max** — Anything more belongs in “Advanced.”
2. **Presets over pickers** — Offer **Good default / Cheaper / Higher quality** (or similar), not raw catalog browsing on first run.
3. **One primary CTA per screen** — The next action is obvious.
4. **Time-boxed success** — “Running in ~10 minutes” means: connected, one happy-path job completed or one route resolving, not “mastered the product.”
5. **Progressive disclosure** — Raw JSON, per-stage model lists, and full routing matrices are **Advanced**; they do not appear on the first-run checklist.

---

## The simple questions (conceptual)

Ask these **once** (wizard or interview), then map answers to **presets** (routes + policy tier from the [generic route starter kit](../restormel/generic-route-starter-kit.md)):

| # | Question | Why it matters |
|---|-----------|----------------|
| 1 | **What are you doing first?** — *Answer questions with our app* / *Ingest documents into the graph* / *Both later* | Chooses the default checklist and which presets to emphasize. |
| 2 | **Rough budget posture?** — *Keep cost low* / *Balanced* / *Quality first* | Maps to policy preset (Economy / Standard / Premium) and default model tier inside routes. |
| 3 | **Where do keys live?** — *Platform* / *Our own keys (BYOK)* | Gates provider list and validation copy; avoids dead ends. |
| 4 | **One “home” route or full pipeline?** — *Single smart default route* / *Full ingestion chain* | Narrow path: one `llm_reason_primary` or starter ingest subset; advanced: all stage routes. |

Optional fifth question only if needed for support: **Environment** (staging vs production)—otherwise default to production and hide.

---

## What we show by default (smallest option set)

### For “answer questions” (reasoning app)

- **One preset:** “Standard reasoning” → maps to three routes internally (`llm_reason_primary`, `llm_reason_critique`, `llm_reason_synthesize`) **or** one composite resolve strategy if the product supports it—but **the user sees one choice**, not three route IDs.
- **Advanced:** per-pass route overrides, model catalog, simulate, policy editor.

### For “ingest documents”

- **One preset:** “Standard ingestion” → subset of stages with defaults (e.g. extract + validate + embed as the **minimum viable** path; relate/group/repair as “Add steps” toggles **off** by default for first run).
- **Advanced:** six-stage editor, JSON payload, per-stage routes, guided pre-scan matrix.

### For Restormel Keys (project owner)

- **Import “starter pack v1”** + **one policy preset** (Standard)—documented in the generic route kit.
- **Advanced:** custom routes, extra policies, environments, history.

---

## Information architecture (dashboard)

| Layer | Purpose |
|-------|---------|
| **Start here** | Checklist + 3–5 questions + single primary CTA (e.g. “Continue with balanced defaults”). |
| **Do work** | Short list: *Run ingestion*, *Open operations*, *Review queue*—not every tool at once. |
| **Advanced** | Collapsed section or separate nav: *Ingestion routing*, *Raw JSON*, *Full catalog*, *Diagnostics*. |

Sophia implementation: **`/admin/quick-start`** is the **Start here** hub; existing pages remain **Do work** / **Advanced** without removing functionality.

**First visit:** Unauthenticated clients still see quick-start; signed-in users hitting **`/admin`** (ingestion home) are redirected to **`/admin/quick-start`** until they dismiss the gate. Dismissal is stored as **`localStorage['sophia.admin.dismiss_quick_start'] = '1'`** when they open ingestion home, operations, or review with **`?from_quick_start=1`**, or ingestion home with **`?skip_quick_start=1`**. **`?setup=1`** on **`/admin`** skips the redirect (expert/deep-link) but does not set dismissal. Params are stripped with **`history.replaceState`** after handling.

---

## Success criteria (~10 minutes)

User can truthfully say:

- [ ] I am signed in with admin access.
- [ ] I completed **one** guided path: either **first ingestion queued** or **first reasoning/settings path** verified.
- [ ] I know where to go **next** (operations, review, or app) without reading unrelated screens.

---

## What we defer (explicitly “later” or “Advanced”)

- Full six-stage tuning before first success.
- Per-model catalog exploration.
- Multiple reusable profiles before one profile works.
- Cross-environment promotion workflows.

---

## Related docs

- [Admin hub redesign brief](./admin-hub-redesign-brief.md) — broader cockpit vision; this doc is the **narrow first-run** slice.
- [Generic Restormel route starter kit](../restormel/generic-route-starter-kit.md) — capability-based route IDs for presets behind the simple questions.
