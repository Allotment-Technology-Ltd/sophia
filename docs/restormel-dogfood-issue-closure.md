# Dogfood thread closure (Sophia source issue)

**Goal:** When **restormel-keys** and **Sophia** have finished all follow-up work for a dogfood thread (upstream merge, consumer bumps/docs/proxies, release-note items checked off), the **original Sophia issue** — the one labeled **`restormel-feedback`** that opened the relay — should receive a **completion comment** and then be **closed**.

**Original issue** means: the **Sophia** GitHub issue that carried the feedback and triggered **[Dogfood]** on **restormel-keys** (linked from the upstream issue as *View source issue*). It is **not** only the Keys ticket; closing the loop on the **consumer** side avoids orphaned open threads.

---

## When “done” counts as done

Treat the thread as complete only when **all** that apply are true:

1. **Restormel-keys:** The **`[Dogfood]`** work is merged (or explicitly wont-fix / superseded — say so in the comment).
2. **Sophia:** Any agreed consumer changes are merged to **`main`** (code, docs, package bumps, admin proxies, etc.).
3. **Release / triage:** If a **`[Restormel Keys] Release … — SOPHIA backlog / triage`** issue exists for the same train, its checklist items relevant to this thread are addressed or explicitly deferred with a note.

If something remains open, **do not** close the Sophia source issue; leave a **status comment** instead.

---

## Agent / operator steps (mandatory order)

1. **Draft** a short completion comment (no secrets). Include:
   - Link to **restormel-keys** **`[Dogfood]`** issue and merged PR(s) / tag if useful.
   - Link to **Sophia** PR(s) or commits on `main`.
   - One-line summary of what shipped on each side.
2. **Post** the comment on the **original Sophia issue** (`gh` or GitHub MCP **`add_issue_comment`**).
3. **Close** the issue immediately after (**`state_reason: completed`** where supported).

**One-shot CLI (preferred when `gh` is available):**

```bash
gh issue close <N> --repo Allotment-Technology-Ltd/sophia --comment "$(cat tmp/restormel-dogfood-completion.md)"
```

Or comment then close in two steps if you prefer separate API calls.

---

## Optional: GitHub Actions (same repo)

For operators who want a **button** instead of a local CLI, use:

**Actions → Restormel dogfood — close source issue with completion comment** (`workflow_dispatch`).

Inputs: Sophia **issue number** + **completion comment** body. The workflow posts the comment and closes the issue using **`GITHUB_TOKEN`** (no extra PAT). See `.github/workflows/restormel-dogfood-close-issue.yml`.

This does **not** run automatically on merge; you run it when you confirm the thread is finished.

---

## Upstream `[Dogfood]` issue (restormel-keys)

Closing the **Sophia** source issue does **not** automatically close the Keys issue. **Keys maintainers** (or your org policy) should close **`[Dogfood]`** when upstream work is done. If you have rights, add a brief comment there too and close with **`completed`**.

---

## Agent prompt (copy for Cursor)

```text
When dogfood or release-follow-up work for a thread is finished (Keys merged + Sophia changes on main + triage done):

1. Identify the original Sophia issue (restormel-feedback relay source), e.g. from the [Dogfood] issue’s “View source issue” link or the user’s issue number.
2. Post a completion comment summarizing Keys + Sophia outcomes with links (no secrets).
3. Close that Sophia issue (gh issue close --comment, GitHub MCP, or ask the human to run the Actions workflow restormel-dogfood-close-issue.yml).
4. Do not close if material work is still open; use a progress comment instead.
```

---

## Related

- [docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md) — relay setup  
- [docs/restormel-dogfood-loop-handover.md](restormel-dogfood-loop-handover.md) — bidirectional automation  
- Proactive filing: `.cursor/rules/restormel-dogfood-feedback-relay.mdc`
