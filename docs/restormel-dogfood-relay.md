# Restormel Keys dogfood relay — consumer setup

**Purpose:** One self-contained document so improvement requirements discovered while dogfooding Restormel Keys are relayed to the **restormel-keys** GitHub repo by default.

**Canonical upstream doc (Restormel Keys repo):** `docs/github-dogfood-feedback.md` — if this copy drifts, prefer the version in the restormel-keys repository.

---

## Standard (trusted projects)

For repositories under **implicit trust** (same org, same operators), the **default** path is:

1. Track friction, SDK gaps, or API issues as **issues in the consumer repo** (normal workflow).
2. When an issue should become a Restormel Keys backlog item, add the label **`restormel-feedback`**.
3. GitHub Actions opens a corresponding issue in **restormel-keys** with a link back (no manual copy-paste).

Manual filing directly in restormel-keys remains available for edge cases; this document does not require it for day-to-day dogfood work.

---

## Credentials (do not mix PATs)

Two different credentials are involved. The **relay** token must not be reused to create issues on Sophia (it is scoped to **restormel-keys** only). The **first hop** (opening a Sophia issue with the label) uses your normal GitHub identity via **`gh`** or a separate PAT with **Sophia** `issues` access.

| Credential | Where it lives | Writes to | Purpose |
|------------|----------------|-----------|---------|
| `RESTORMEL_KEYS_ISSUE_TOKEN` | Sophia **Actions** secret (or **org** secret limited to this repo) | **restormel-keys** | Relay workflow only — creates `[Dogfood]` upstream issues |
| `gh` login / fine-grained PAT / GitHub MCP | Developer machine (never committed) | **Sophia** | Create the consumer issue and apply `restormel-feedback` |

**Same organization:** Sophia and restormel-keys can live under one GitHub org. That does **not** let the default `GITHUB_TOKEN` in Sophia Actions create issues in restormel-keys (it stays repo-scoped). It *does* allow an **org-level** Actions secret for `RESTORMEL_KEYS_ISSUE_TOKEN` shared only with repos that run the relay. For local tooling, one fine-grained PAT may list both repos (Issues read/write) for convenience; prefer a **Sophia-only** PAT if you want the smallest blast radius.

---

## Human setup (once per consumer repo)

### 1. Fine-grained personal access token (upstream)

Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Personal access tokens) with:

- **Repository access:** only the **restormel-keys** repository (`Allotment-Technology-Ltd` / `restormel-keys`).
- **Permissions:** **Issues: Read and write** only (no contents, no metadata beyond what is needed).

Do not commit the token. Do not paste it into issues or logs.

### 2. Actions secret (consumer repo — this repo)

In the **consumer** repository: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `RESTORMEL_KEYS_ISSUE_TOKEN`
- **Value:** the PAT from step 1.

**Optional (same org):** define the same secret at **organization** level and grant access only to this repo (and any other dogfood consumers), so you do not duplicate the value per repository.

### 3. Label (consumer repo)

Create an issue label **exactly:** `restormel-feedback`  
(Colour/description optional; the workflow matches this name only.)

### 4. Workflow file (consumer repo)

This repo includes `.github/workflows/restormel-dogfood-relay.yml`. It relays to `Allotment-Technology-Ltd/restormel-keys` and runs **only** when the repository is `Allotment-Technology-Ltd/sophia` (so forks do not execute the relay or consume secrets).

```yaml
name: Relay dogfood issue to Restormel Keys

on:
  issues:
    types: [labeled]

jobs:
  relay:
    if: >-
      github.event.label.name == 'restormel-feedback' &&
      github.repository == 'Allotment-Technology-Ltd/sophia'
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
              owner: 'Allotment-Technology-Ltd',
              repo: 'restormel-keys',
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

## Operator and agent: file feedback (first hop)

Automate creating the **Sophia** issue with the relay label. The existing Actions workflow then opens the issue on **restormel-keys**.

### GitHub CLI (`gh`)

Prerequisites: [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`) with permission to open issues on `Allotment-Technology-Ltd/sophia`. The label **`restormel-feedback`** must already exist (see Human setup).

```bash
gh issue create --repo Allotment-Technology-Ltd/sophia \
  --title "Restormel Keys: …" \
  --body-file feedback.md \
  --label restormel-feedback
```

To pass the body on stdin (for example from a here-doc or pipe):

```bash
printf '%s\n' "## Summary" "" "Your markdown here." | \
  gh issue create --repo Allotment-Technology-Ltd/sophia \
  --title "Restormel Keys: short title" \
  --body-file - \
  --label restormel-feedback
```

### Wrapper script (repo root)

From the repository root:

```bash
./scripts/restormel/create_dogfood_issue.sh --title "Restormel Keys: …" --body-file feedback.md
```

Or pipe body text:

```bash
cat feedback.md | ./scripts/restormel/create_dogfood_issue.sh --title "Restormel Keys: …"
```

**npm:** `pnpm restormel:dogfood-issue -- --title "Restormel Keys: …" --body-file feedback.md`  
Override target repo if needed: `SOPHIA_GH_REPO=owner/sophia ./scripts/restormel/create_dogfood_issue.sh …`

### Issue template

Use **New issue → Restormel Keys dogfood feedback** in GitHub; it applies **`restormel-feedback`** on submit and triggers the relay (verify once after changes).

### Cursor: GitHub MCP (official remote server)

Use GitHub’s **hosted** MCP server so agents can call GitHub tools (e.g. create issues) without pasting tokens into chat. Requires **Cursor v0.48.0+** (Streamable HTTP). Upstream reference: [github/github-mcp-server — Install in Cursor](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-cursor.md).

1. Add a **`github`** entry to MCP config (merge with your existing servers):
   - **Global:** `~/.cursor/mcp.json`
   - **Or project-only:** copy [`.cursor/mcp.json.example`](.cursor/mcp.json.example) to `.cursor/mcp.json` in this repo and merge manually if you already use a project MCP file.

2. Use this shape (replace the placeholder with a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to **Sophia** with **Issues: Read and write**; optional second repo **restormel-keys** only if you need broader GitHub tools):

```json
"github": {
  "url": "https://api.githubcopilot.com/mcp/",
  "headers": {
    "Authorization": "Bearer YOUR_GITHUB_PAT"
  }
}
```

3. **Cursor:** Settings → **Tools & Integrations** → **MCP** → confirm the **github** server shows a healthy status; restart Cursor after edits.

4. **Dogfood relay:** Use MCP to **`create_issue`** on **`Allotment-Technology-Ltd` / `sophia`** with **`labels: ["restormel-feedback"]`** so Actions opens the **`[Dogfood]`** issue on **restormel-keys**. Do not put secrets in the issue body.

**Deprecated:** the npm package `@modelcontextprotocol/server-github` is obsolete; prefer the remote URL above or the official Docker image `ghcr.io/github/github-mcp-server` (see upstream README).

---

## Agent prompt (copy this block for Cursor)

Use this in the **consumer** repository when you want an agent to implement or verify the Restormel dogfood relay.

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
