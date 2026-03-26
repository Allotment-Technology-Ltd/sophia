# Restormel Keys dogfood relay — consumer setup (copy this file)

**Purpose:** One self-contained document to copy into a **trusted consumer repository** (e.g. SOPHIA) so improvement requirements discovered while dogfooding Restormel Keys are relayed to the **restormel-keys** GitHub repo by default.

**How to use this file:** Copy the whole file into your consumer repo (recommended path: `docs/restormel-dogfood-relay.md`). Complete the **Human setup** steps once. Use the **Agent prompt** when you want an AI agent in the consumer repo to apply or verify this setup.

**Canonical upstream doc (Restormel Keys repo):** `docs/github-dogfood-feedback.md` — if this copy drifts, prefer the version in the restormel-keys repository.

---

## Standard (trusted projects)

For repositories under **implicit trust** (same org, same operators), the **default** path is:

1. Track friction, SDK gaps, or API issues as **issues in the consumer repo** (normal workflow).
2. When an issue should become a Restormel Keys backlog item, add the label **`restormel-feedback`**.
3. GitHub Actions opens a corresponding issue in **restormel-keys** with a link back (no manual copy-paste).

Manual filing directly in restormel-keys remains available for edge cases; this document does not require it for day-to-day dogfood work.

---

## Human setup (once per consumer repo)

### 1. Fine-grained personal access token (upstream)

Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Personal access tokens) with:

- **Repository access:** only the **restormel-keys** repository (replace `OWNER` / `REPO` below with your GitHub owner and repo name, e.g. `Allotment-Technology-Ltd` / `restormel-keys`).
- **Permissions:** **Issues: Read and write** only (no contents, no metadata beyond what is needed).

Do not commit the token. Do not paste it into issues or logs.

### 2. Actions secret (consumer repo — this repo)

In the **consumer** repository: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `RESTORMEL_KEYS_ISSUE_TOKEN`
- **Value:** the PAT from step 1.

### 3. Label (consumer repo)

Create an issue label **exactly:** `restormel-feedback`  
(Colour/description optional; the workflow matches this name only.)

### 4. Workflow file (consumer repo)

Create `.github/workflows/restormel-dogfood-relay.yml` with the content below. Replace **`YOUR_ORG`** and **`YOUR_REPO`** with the GitHub owner and repository name of **restormel-keys** (not the consumer repo).

```yaml
name: Relay dogfood issue to Restormel Keys

on:
  issues:
    types: [labeled]

jobs:
  relay:
    if: github.event.label.name == 'restormel-feedback'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: read
    steps:
      - uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.RESTORMEL_KEYS_ISSUE_TOKEN }}
          script: |
            const issue = context.payload.issue;
            const body = [
              'Relayed from a **dogfood** consumer repository.',
              '',
              '| Field | Value |',
              '|--------|--------|',
              `| Source repo | \`${{ github.repository }}\` |`,
              `| Source issue | #${issue.number} |`,
              '',
              '### Source title',
              '',
              issue.title,
              '',
              '### Source body',
              '',
              issue.body || '_(empty)_',
              '',
              '---',
              `[View source issue](${issue.html_url})`,
            ].join('\n');
            const rawTitle = `[Dogfood] ${issue.title}`;
            const title = rawTitle.length > 256 ? rawTitle.slice(0, 253) + '...' : rawTitle;
            await github.rest.issues.create({
              owner: 'YOUR_ORG',
              repo: 'YOUR_REPO',
              title,
              body,
              labels: ['task'],
            });
```

### 5. Verify

1. Open a **test issue** in the consumer repo (no secrets in the body).
2. Apply the label **`restormel-feedback`**.
3. Confirm a workflow run succeeds in **Actions** and a new issue appears in **restormel-keys** with title prefix `[Dogfood]` and a link back.

### Hygiene

- **Do not** label issues that contain raw API keys, tokens, or other secrets; redact first.
- Re-applying the label can create **duplicate** upstream issues; avoid relabeling unless you intend a new upstream ticket.

---

## Agent prompt (copy this block for Cursor)

Use this in the **consumer** repository (e.g. SOPHIA) when you want an agent to implement or verify the Restormel dogfood relay.

```text
You are working in a trusted consumer repository that dogfoods Restormel Keys. The default way we send improvement requirements back to the Restormel Keys GitHub repo is label-based relay (not manual copy-paste).

Your task:

1. Ensure this repo has the GitHub Actions workflow at `.github/workflows/restormel-dogfood-relay.yml` exactly as specified in `docs/restormel-dogfood-relay.md` (or the local copy of `restormel-dogfood-relay-consumer-pack.md`), including replacing `YOUR_ORG` and `YOUR_REPO` with the correct GitHub owner and repository name for the **restormel-keys** upstream repo (the destination for relayed issues — not this consumer repo).

2. Ensure the issue label `restormel-feedback` exists in this repo (exact name). Document in a short note or PR description if the label was created.

3. Do **not** create, commit, or echo any personal access token. Secrets must be added only via GitHub: Settings → Secrets and variables → Actions → repository secret `RESTORMEL_KEYS_ISSUE_TOKEN`. If the secret is missing, tell the human to create a fine-grained PAT with Issues read/write on the restormel-keys repo only and add that secret.

4. Confirm the workflow does not run on forks in a way that leaks secrets (if this is a fork, call out that the human should not enable Actions with upstream secrets on untrusted forks).

5. After changes, describe how to verify: open a test issue without secrets, apply `restormel-feedback`, and confirm an issue appears in restormel-keys with `[Dogfood]` in the title and a link back to the source issue.

If `docs/restormel-dogfood-relay.md` does not exist, create it by copying the contents of the Restormel Keys document `docs/reference/restormel-dogfood-relay-consumer-pack.md` from the restormel-keys repo (or ask the human to paste that file in), then apply steps 1–5.
```

---

*Maintained in restormel-keys as `docs/reference/restormel-dogfood-relay-consumer-pack.md`.*
