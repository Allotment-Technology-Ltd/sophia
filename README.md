# SOPHIA

**Philosophical reasoning engine with ethics knowledge base, deploying via GitHub Actions to Google Cloud Run.**

## Project Status

**Phase 3a ✅ Complete** (Tag: `phase-3a-complete`)
- Ethics knowledge base ingestion pipeline fully operational
- 8 foundational philosophical sources ingested with LLM validation
- SurrealDB persistent storage on GCE VM + Cloud Run test instance
- Multi-pass reasoning engine integrated with graph context retrieval
- All API keys (Voyage AI, Gemini) rotated and secured in GCP Secret Manager

**Current Version**: 3a | **Production Ready**: Yes (with monitoring)

See [CHANGELOG.md](CHANGELOG.md) for Phase 3a deliverables and [docs/phase-3b-roadmap.md](docs/phase-3b-roadmap.md) for upcoming work.

## Quick Start

### Local Development
```bash
# Install dependencies
npm install

# Set up environment (see .env.example)
cp .env.example .env
# Edit .env with your API keys and database connection

# Run development server
npm run dev

# Access at http://localhost:5173
```

### Knowledge Base Management
```bash
# Ingest a single source
npx ts-node scripts/ingest.ts <source-url>

# Batch ingest multiple sources
npx ts-node scripts/ingest-batch.ts

# Verify database integrity
npx ts-node scripts/verify-db.ts

# Set up database schema (first time only)
npx ts-node scripts/setup-schema.ts
```

### Deployment
```bash
# Deploy to Cloud Run (via GitHub Actions on main push)
git push origin main
# View deployment: https://github.com/Allotment-Technology-Ltd/sophia/actions
```

## Architecture Overview

### Technology Stack
- **Frontend**: SvelteKit + Vite + Tailwind CSS
- **Backend**: Node.js + SvelteKit Server
- **Database**: SurrealDB (graph-based knowledge storage)
- **LLM APIs**: Google Gemini (reasoning), Voyage AI (embeddings)
- **Deployment**: Google Cloud Run (stateless) + GCE VM (SurrealDB)
- **CI/CD**: GitHub Actions

### Core Components

#### Web Application (`/src`)
- **Routes**: Main conversation interface (`+page.svelte`), admin dashboard (`/admin`)
- **API**: `/api/analyse` endpoint for three-pass reasoning
- **Server**: Database and LLM integration (`/src/lib/server`)
- **State Management**: Svelte stores for conversation context

#### Knowledge Base
- **Storage**: SurrealDB graph database with claims, arguments, and relations
- **Schema**: Ethics domain model with philosophical schools and concepts
- **Ingestion**: 7-pass pipeline (fetch → extract → validate → embed → score → rank → store)

#### Reasoning Engine
- **Three-Pass Analysis**:
  1. **Pass 1 (Analysis)**: Extract core arguments from user query using knowledge graph context
  2. **Pass 2 (Critique)**: Challenge assumptions and identify counterarguments
  3. **Pass 3 (Synthesis)**: Integrate multiple perspectives toward balanced conclusion
- **LLM Integration**: Prompts in `/src/lib/server/prompts`

#### Retrieval & Context
- **Graph Traversal**: Multi-hop argument retrieval from knowledge base
- **Argument-Aware**: Returns structured philosophical arguments with citations
- **Graceful Degradation**: Works without SurrealDB using fallback prompts

### Data Flow
```
User Query
  ↓
Retrieve Graph Context (SurrealDB)
  ↓
Pass 1: Analysis (Gemini + context)
  ↓
Pass 2: Critique (Gemini + context)
  ↓
Pass 3: Synthesis (Gemini + context)
  ↓
Response to User
```

## Knowledge Base Contents

### Wave 1 Sources (Complete - Phase 3a)
1. Stanford Encyclopedia of Philosophy: Utilitarianism
2. John Stuart Mill: Utilitarianism (excerpts)
3. Peter Singer: Famine, Affluence, and Morality
4. Stanford Encyclopedia of Philosophy: Deontological Ethics
5. Immanuel Kant: Groundwork of the Metaphysics of Morals (excerpts)
6. W.D. Ross: The Right and the Good (excerpts)
7. Stanford Encyclopedia of Philosophy: Virtue Ethics
8. Aristotle: Nicomachean Ethics (excerpts)

**Stats**: ~500+ claims, ~400+ relations extracted and validated

### Wave 2 & 3 Sources (Phase 3b - In Planning)
10 additional Wave 2 sources + 11 Wave 3 sources covering consequentialism, Kantian ethics, rights, applied ethics, and bioethics.

See [docs/phase-3b-roadmap.md](docs/phase-3b-roadmap.md) for details.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).

## Need an official Svelte framework?

Check out [SvelteKit](https://github.com/sveltejs/kit#readme), which is also powered by Vite. Deploy anywhere with its serverless-first approach and adapt to various platforms, with out of the box support for TypeScript, SCSS, and Less, and easily-added support for mdsvex, GraphQL, PostCSS, Tailwind CSS, and more.

## Technical considerations

**Why use this over SvelteKit?**

- It brings its own routing solution which might not be preferable for some users.
- It is first and foremost a framework that just happens to use Vite under the hood, not a Vite app.

This template contains as little as possible to get started with Vite + Svelte, while taking into account the developer experience with regards to HMR and intellisense. It demonstrates capabilities on par with the other `create-vite` templates and is a good starting point for beginners dipping their toes into a Vite + Svelte project.

Should you later need the extended capabilities and extensibility provided by SvelteKit, the template has been structured similarly to SvelteKit so that it is easy to migrate.

**Why include `.vscode/extensions.json`?**

Other templates indirectly recommend extensions via the README, but this file allows VS Code to prompt the user to install the recommended extension upon opening the project.

**Why enable `checkJs` in the JS template?**

It is likely that most cases of changing variable types in runtime are likely to be accidental, rather than deliberate. This provides advanced typechecking out of the box. Should you like to take advantage of the dynamically-typed nature of JavaScript, it is trivial to change the configuration.

**Why is HMR not preserving my local component state?**

HMR state preservation comes with a number of gotchas! It has been disabled by default in both `svelte-hmr` and `@sveltejs/vite-plugin-svelte` due to its often surprising behavior. You can read the details [here](https://github.com/sveltejs/svelte-hmr/tree/master/packages/svelte-hmr#preservation-of-local-state).

If you have state that's important to retain within a component, consider creating an external store which would not be replaced by HMR.

```js
// store.js
// An extremely simple external store
import { writable } from 'svelte/store'
export default writable(0)
```
