# Handover: Restormel Keys ↔ Sophia dogfood loop (test run)

**Audience:** Operators on **Sophia** and **restormel-keys** validating the relay and upstream-notify automation.

**Canonical policy (restormel-keys repo):** [docs/github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md)

**Sophia relay setup (this repo):** [docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md)

---

## What has been implemented (restormel-keys repo)

| Item | Purpose |
|------|--------|
| **`dogfood-issue-hint.yml`** | When a **`[Dogfood]`** issue is **opened** on **restormel-keys**, Actions posts a short comment with links to the implementation runbook and security notes. |
| **`dogfood-agent-open-pr.yml`** + **`scripts/dogfood-agent-open-pr.mjs`** | **Optional.** Uses an LLM (OpenAI and/or Anthropic via **GitHub Actions secrets**) to propose edits and open a **draft PR** on **restormel-keys** only. Human review required before merge. |
| **`dogfood-upstream-notify-consumer.yml`** | **Optional.** On **push** of a **`keys-v*`** tag (same family as the npm publish tag), opens a **tracking issue** on the **consumer** repo configured by variable **`DOGFOOD_NOTIFY_CONSUMER`** (e.g. Sophia). |

**Docs and rules (restormel-keys):** Runbook [restormel-dogfood-issue-implementation.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/runbooks/restormel-dogfood-issue-implementation.md), Cursor rule `.cursor/rules/07-dogfood-github-issues.mdc`, and expanded sections in [github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md) (including upstream notify and PAT notes).

---

## What Sophia should expect going forward

1. **Unchanged — Sophia → restormel-keys**  
   Label **`restormel-feedback`** on a Sophia issue still drives creation of a **`[Dogfood]`** issue on **restormel-keys** (this repo’s relay workflow). No change required unless the relay is not deployed on **`main`** or **`RESTORMEL_KEYS_ISSUE_TOKEN`** is missing.

2. **New — restormel-keys → Sophia (after a keys release tag)**  
   When **restormel-keys** maintainers push a **`keys-v*`** tag (and upstream notify is configured), Sophia may receive a **new issue**:
   - **Title pattern:** `[Restormel Keys] Release keys-v…`
   - **Label:** `restormel-upstream-release` (created automatically on first run if missing)
   - **Body:** Links to the tag tree, **CHANGELOG** on that ref, upstream **`[Dogfood]`** search, and a short checklist (npm versions, host-app bumps, close linked threads). **No secrets** should appear in that body.

3. **Not automatic**  
   - No Sophia PR is opened by this workflow.  
   - No automatic comment on old Sophia issues or on the original relay thread — unless you add that later.

---

## Preconditions before a test (GitHub settings)

**On restormel-keys**

- **Variable:** `DOGFOOD_NOTIFY_CONSUMER` = `Allotment-Technology-Ltd/sophia` (or your real `owner/repo`).
- **Secret:** Either **`DOGFOOD_NOTIFY_CONSUMER_TOKEN`** or **`RESTORMEL_KEYS_ISSUE_TOKEN`** available to **restormel-keys** Actions, with a PAT that can open **issues on Sophia**.  
  - If you reuse **`RESTORMEL_KEYS_ISSUE_TOKEN`**, the org secret must be **allowed for the restormel-keys repository**, not only Sophia, and the PAT must include **Issues** on **sophia** (not only restormel-keys).

**On Sophia**

- Existing **relay** secret and workflow remain as today ([docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md)).  
- **No new code** is required for the upstream-notify issue to appear.

**Optional (draft PR agent on restormel-keys)**

- **`OPENAI_API_KEY`** and/or **`ANTHROPIC_API_KEY`** in Actions secrets if you want to trial the CI agent.

---

## Suggested test plan

### A) Upstream notify (restormel-keys → Sophia issue)

1. Confirm **`DOGFOOD_NOTIFY_CONSUMER`** and PAT visibility on **restormel-keys** (see above).
2. In **restormel-keys**: **Actions** → **Dogfood upstream — notify consumer** → **Run workflow**.
3. Set **tag** to an **existing** `keys-v*` tag on the repo (e.g. latest published train).
4. Leave **force** unchecked first run (duplicate detection: skips if an issue with that tag in the title already exists on Sophia).
5. On **Sophia**: open **Issues** and verify a new issue with title **`[Restormel Keys] Release <tag>`** and label **`restormel-upstream-release`**.
6. If the job skipped as duplicate, either use **force** = true on a manual run or pick a different tag string for a one-off test.

**Alternative:** Push a new **`keys-v*`** tag to **restormel-keys** `main` (coordinated with release process); the same workflow runs on tag push.

### B) Relay (Sophia → restormel-keys) — regression check

1. Open a test issue on **Sophia** (no real secrets in title/body).
2. Add label **`restormel-feedback`**.
3. Confirm a **`[Dogfood]`** issue appears on **restormel-keys** with link back to Sophia.

### C) Optional — hint comment

1. Open any new **`[Dogfood]`** issue on **restormel-keys** (or use one created by the relay).
2. Confirm **Dogfood issue — implementation hint** workflow added a comment with runbook link.

### D) Optional — CI draft PR agent

1. Ensure LLM secret(s) exist on **restormel-keys**.
2. **Actions** → **Dogfood agent — draft PR** → run with an issue number; start with **dry run** if offered.
3. Expect a **draft PR** on **restormel-keys** or a noop / failure with logs — still **human** merge.

---

## Security reminders (both repos)

- Do **not** paste API keys, gateway keys, or PATs into issue bodies or PR descriptions.  
- Treat relayed issue bodies as **untrusted** until reviewed.  
- Prefer **narrow** fine-grained PATs for automation over a single over-scoped token long term.

---

## References

- [github-dogfood-feedback.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/github-dogfood-feedback.md) (restormel-keys)  
- [restormel-dogfood-issue-implementation.md](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/runbooks/restormel-dogfood-issue-implementation.md) (restormel-keys)  
- Workflows (restormel-keys): `.github/workflows/dogfood-*.yml`  
- Sophia relay: [docs/restormel-dogfood-relay.md](restormel-dogfood-relay.md), `.github/workflows/restormel-dogfood-relay.yml`
