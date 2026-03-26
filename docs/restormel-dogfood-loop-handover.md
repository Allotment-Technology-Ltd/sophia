# Handover: Restormel Keys ↔ Sophia dogfood loop (test run)

**Audience:** Operators on **Sophia** and **restormel-keys** validating the relay and upstream-notify automation.

**Canonical policy (restormel-keys repo):** [docs/github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md)

**Sophia-focused test notes (upstream):** [docs/reference/restormel-dogfood-sophia-handover.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/reference/restormel-dogfood-sophia-handover.md)

**Sophia relay setup (this repo):** [docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md)

---

## What has been implemented (restormel-keys repo)

| Item | Purpose |
|------|--------|
| **`dogfood-issue-hint.yml`** | When a **`[Dogfood]`** issue is **opened** on **restormel-keys**, Actions posts a short comment with links to the implementation runbook and security notes. |
| **`dogfood-agent-open-pr.yml`** + **`scripts/dogfood-agent-open-pr.mjs`** | **Optional.** Uses an LLM (OpenAI and/or Anthropic via **GitHub Actions secrets**) to propose edits and open a **draft PR** on **restormel-keys** only. Human review required before merge. |
| **`dogfood-upstream-notify-consumer.yml`** + **`scripts/sophia-release-notify-issue.mjs`** | **Optional.** On **push** of **`keys-v*`** or **`restormel-v*`** (notify **independent of npm publish**), opens a **Sophia backlog** issue when **`DOGFOOD_NOTIFY_CONSUMER`** is set — title **`[Restormel Keys] Release <tag> — SOPHIA backlog / triage`**, optional **CHANGELOG** excerpt, triage for API / dashboard / docs / npm. |
| **`dogfood-pr-comment-consumer.yml`** + **`scripts/dogfood-pr-notify-consumer.mjs`** | **Optional.** When a PR targeting **`main`** is **opened** or **merged**, posts on the **original Sophia issue** linked from the relayed **`[Dogfood]`** ticket (PR body **Fixes/Closes/Addresses #N** on the Keys issue). Same **`DOGFOOD_NOTIFY_CONSUMER`** + PAT as upstream notify. |

**Docs and rules (restormel-keys):** Runbook [restormel-dogfood-issue-implementation.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/runbooks/restormel-dogfood-issue-implementation.md), Cursor rule `.cursor/rules/07-dogfood-github-issues.mdc`, [github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md).

---

## What Sophia should expect going forward

1. **Unchanged — Sophia → restormel-keys**  
   Label **`restormel-feedback`** on a Sophia issue still drives creation of a **`[Dogfood]`** issue on **restormel-keys** (this repo’s relay workflow). No change unless the relay is not on **`main`** or **`RESTORMEL_KEYS_ISSUE_TOKEN`** is missing.

2. **New — restormel-keys → Sophia (release-notify tags)**  
   When maintainers push **`keys-v*`** or **`restormel-v*`** and notify is configured, Sophia may receive a **new issue** (not conditional on npm publish):
   - **Title pattern:** **`[Restormel Keys] Release <tag> — SOPHIA backlog / triage`**
   - **Label:** `restormel-upstream-release` (auto-created on first run if missing)
   - **Body:** CHANGELOG section when heading matches **`## <tag>`**, triage table, links (OpenAPI, keys-catalog-sync, guides, tree). **No secrets.**

3. **Optional — PR loop (comments only)**  
   **`dogfood-pr-comment-consumer`** comments on the **existing** Sophia source issue (e.g. [#74](https://github.com/Allotment-Technology-Ltd/sophia/issues/74)) when a Keys PR that **Fixes/Closes/Addresses** the **`[Dogfood]`** issue is opened or merged — e.g. merge of [restormel-keys#52](https://github.com/Allotment-Technology-Ltd/restormel-keys/pull/52). Requires **`DOGFOOD_NOTIFY_CONSUMER`** + PAT on **restormel-keys**. **No automatic Sophia PR** from Restormel.

---

## Preconditions before a test (GitHub settings)

**On restormel-keys**

- **Variable:** `DOGFOOD_NOTIFY_CONSUMER` = `Allotment-Technology-Ltd/sophia`. **Same variable gates** (1) release backlog issues and (2) **PR open/merge comments** on the consumer issue. If **unset**, those jobs skip — Sophia sees nothing from them.
- **Secret:** **`DOGFOOD_NOTIFY_CONSUMER_TOKEN`** or **`RESTORMEL_KEYS_ISSUE_TOKEN`** on **restormel-keys** Actions, PAT with **Issues** on **sophia**. Org secrets must be **allowed for restormel-keys**, not only Sophia, if reused.

**On Sophia**

- Relay secret + [restormel-dogfood-relay.md](restormel-dogfood-relay.md) workflow as today.

**Optional (draft PR agent on restormel-keys)**

- **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** in Actions secrets.

---

## Suggested test plan

### A) Upstream notify (restormel-keys → Sophia issue)

1. Confirm **`DOGFOOD_NOTIFY_CONSUMER`** and PAT on **restormel-keys**.
2. **Actions** → **Dogfood upstream — notify consumer** → **Run workflow** with an existing **`keys-v*`** or **`restormel-v*`** tag.
3. On Sophia: issue titled **`[Restormel Keys] Release <tag> — SOPHIA backlog / triage`**, label **`restormel-upstream-release`**.
4. Use **force** or another tag if duplicate detection skips.

**Alternative:** Push a new **`keys-v*`** / **`restormel-v*`** tag.

### B) Relay (Sophia → restormel-keys)

1. Test issue + label **`restormel-feedback`** → **`[Dogfood]`** on restormel-keys with link back.

### C) PR → consumer comment (e.g. after #52)

1. With notify configured, confirm a **comment** on the **Sophia** issue linked from the **`[Dogfood]`** issue (not a new issue). Links to **CHANGELOG** / **keys-v*** may appear on merge.

### D) Optional — hint comment, CI draft PR agent

See upstream runbook and [github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md).

---

## Security reminders (both repos)

- Do **not** paste API keys, gateway keys, or PATs into issue bodies or PR descriptions.  
- Treat relayed issue bodies as **untrusted** until reviewed.  
- Prefer **narrow** fine-grained PATs for automation.

---

## References

- [CHANGELOG.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/CHANGELOG.md) (restormel-keys **Repo (2026-03-27)** — dogfood PR consumer, notify, docs #45)  
- [github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md)  
- [restormel-dogfood-sophia-handover.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/reference/restormel-dogfood-sophia-handover.md)  
- Workflows (restormel-keys): `.github/workflows/dogfood-*.yml`  
- Sophia relay: [docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md)
