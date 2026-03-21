<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    CHAT_MODELS_BY_PROVIDER,
    DEFAULT_WIZARD_EMBED_ID,
    DEFAULT_WIZARD_EXTRACT_ID,
    DEFAULT_WIZARD_GROUP_ID,
    DEFAULT_WIZARD_VALIDATE_ID,
    EMBEDDING_MODELS_BY_PROVIDER,
    getWizardModelById,
    type AdminIngestWizardModelOption
  } from '$lib/adminIngestWizardModels';

  // ─── Types ────────────────────────────────────────────────────────────────

  type ModelOption = AdminIngestWizardModelOption;

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';

  type Stage = {
    key: string;
    step: number;
    label: string;
    description: string;
    usesModel: boolean;
    provider?: string;
    fixedProviderNote?: string;
    status: StageStatus;
    result?: string;
  };

  type WizardStep = 'source' | 'models' | 'confirm' | 'running' | 'done';

  const SOURCE_TYPES = [
    { value: 'sep_entry',       label: 'Stanford Encyclopedia of Philosophy' },
    { value: 'iep_entry',       label: 'Internet Encyclopedia of Philosophy' },
    { value: 'journal_article', label: 'Academic paper / journal article' },
    { value: 'book',            label: 'Book (Project Gutenberg or plain text)' },
    { value: 'web_article',     label: 'General web source' }
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let wizardStep  = $state<WizardStep>('source');

  // Step 1
  let sourceUrl   = $state('');
  let sourceType  = $state('sep_entry');
  let urlError    = $state('');

  // Step 2 — ids from shared catalog (`provider__modelId`)
  let extractModel  = $state(DEFAULT_WIZARD_EXTRACT_ID);
  let relateModel   = $state(DEFAULT_WIZARD_EXTRACT_ID);
  let groupModel    = $state(DEFAULT_WIZARD_GROUP_ID);
  let validateModel = $state(DEFAULT_WIZARD_VALIDATE_ID);
  let embedModel    = $state(DEFAULT_WIZARD_EMBED_ID);
  let runValidation = $state(false);

  // Steps 4–5: pipeline
  let stages = $state<Stage[]>([
    {
      key: 'fetch',
      step: 0,
      label: 'Fetch & Parse',
      description: 'Pull the URL, strip HTML, save raw text and metadata.',
      usesModel: false,
      provider: 'fixed',
      fixedProviderNote: 'HTTP fetch — no AI model needed',
      status: 'idle'
    },
    {
      key: 'extract',
      step: 1,
      label: 'Segment & Extract Claims',
      description: 'Split into ~900-token passages, extract structured claims with type, domain, thinker, era, and confidence.',
      usesModel: true,
      provider: 'routed',
      status: 'idle'
    },
    {
      key: 'relate',
      step: 2,
      label: 'Extract Relations',
      description: 'Map supports / contradicts / depends_on / responds_to / defines / qualifies edges between claims.',
      usesModel: true,
      provider: 'routed',
      status: 'idle'
    },
    {
      key: 'group',
      step: 3,
      label: 'Group into Arguments',
      description: 'Cluster claims into named philosophical arguments; assign roles (conclusion, premise, objection, response).',
      usesModel: true,
      provider: 'routed',
      status: 'idle'
    },
    {
      key: 'embed',
      step: 4,
      label: 'Embed Claims',
      description: 'Vector embeddings for semantic search — pick Vertex, Google, or Voyage ids to align with Restormel / BYOK.',
      usesModel: true,
      provider: 'embedding',
      status: 'idle'
    },
    {
      key: 'validate',
      step: 5,
      label: 'Validate (optional)',
      description: 'Cross-check faithfulness, coherence, and role clarity. Items below threshold get needs_review.',
      usesModel: true,
      provider: 'routed',
      status: 'idle'
    },
    {
      key: 'store',
      step: 6,
      label: 'Store in SurrealDB',
      description: 'Write sources, passages, claims, graph-edge relations, and arguments — idempotent, dependency-ordered.',
      usesModel: false,
      provider: 'fixed',
      fixedProviderNote: 'SurrealDB write — no AI model needed',
      status: 'idle'
    }
  ]);

  let runLog    = $state<string[]>([]);
  let runError  = $state('');
  let runId     = $state('');
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Derived ──────────────────────────────────────────────────────────────

  const slugPreview = $derived.by(() => {
    try {
      const u = new URL(sourceUrl);
      return u.pathname.split('/').filter(Boolean).pop() ?? '';
    } catch { return ''; }
  });

  const WIZARD_STEPS: WizardStep[] = ['source', 'models', 'confirm', 'running', 'done'];

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getModel(id: string): ModelOption | undefined {
    return getWizardModelById(id);
  }

  function estimateCost(): string {
    const e = getModel(extractModel);
    const r = getModel(relateModel);
    const g = getModel(groupModel);
    const v = runValidation ? getModel(validateModel) : null;
    const emb = getModel(embedModel);
    if (!e || !r || !g) return '—';
    const total =
      50 * e.costPer1k +
      20 * r.costPer1k +
      10 * g.costPer1k +
      (v ? 15 * v.costPer1k : 0) +
      (emb ? 8 * emb.costPer1k : 0) +
      0.02;
    return `~$${total.toFixed(3)}`;
  }

  function estimateTime(): string {
    const e = getModel(extractModel);
    const r = getModel(relateModel);
    const g = getModel(groupModel);
    const v = runValidation ? getModel(validateModel) : null;
    if (!e || !r || !g) return '—';
    const speeds = [e.speed, r.speed, g.speed, runValidation ? (v?.speed ?? 4) : 5];
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    return `~${Math.round(12 - (avg - 1) * 1.8)} min`;
  }

  function stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function tierToken(tier: string): string {
    if (tier === 'fast')     return 'var(--color-blue)';
    if (tier === 'balanced') return 'var(--color-sage)';
    return 'var(--color-amber)';
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  function validateSource(): boolean {
    urlError = '';
    if (!sourceUrl.trim()) { urlError = 'Please enter a URL.'; return false; }
    try { new URL(sourceUrl); } catch {
      urlError = "That doesn't look like a valid URL."; return false;
    }
    return true;
  }

  function goToModels()  { if (validateSource()) wizardStep = 'models'; }
  function goToConfirm() { wizardStep = 'confirm'; }
  function goBack() {
    if (wizardStep === 'models')  wizardStep = 'source';
    if (wizardStep === 'confirm') wizardStep = 'models';
  }

  // ─── Run pipeline ─────────────────────────────────────────────────────────

  async function startRun() {
    wizardStep = 'running';
    runLog     = [];
    runError   = '';
    stages     = stages.map(s => ({ ...s, status: 'idle' as StageStatus, result: undefined }));

    const emb = getModel(embedModel);
    const payload = {
      source_url:  sourceUrl,
      source_type: sourceType,
      validate:    runValidation,
      embedding_model: emb?.label ?? embedModel,
      model_chain: {
        extract:  extractModel,
        relate:   relateModel,
        group:    groupModel,
        validate: validateModel
      }
    };

    try {
      const res = await fetch('/api/admin/ingest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? 'Run failed to start.');
      }

      const data = await res.json();
      runId  = data.run_id ?? 'unknown';
      runLog = [`Run started — ID: ${runId}`];
      pollProgress();
    } catch (e: unknown) {
      runError   = e instanceof Error ? e.message : 'Unknown error';
      wizardStep = 'confirm';
    }
  }

  function pollProgress() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/ingest/run/${runId}/status`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.stages) {
          stages = stages.map(s => ({
            ...s,
            status:  data.stages[s.key]?.status  ?? s.status,
            result:  data.stages[s.key]?.summary
          }));
        }

        if (data.logLines && Array.isArray(data.logLines)) {
          runLog = data.logLines;
        }

        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollingInterval!);
          pollingInterval = null;
          if (data.status === 'done') {
            wizardStep = 'done';
          } else {
            runError = data.error ?? 'Pipeline failed.';
          }
        }
      } catch {
        // transient — keep polling
      }
    }, 1500);
  }

  function resetWizard() {
    wizardStep  = 'source';
    sourceUrl   = '';
    stages      = stages.map(s => ({ ...s, status: 'idle' as StageStatus, result: undefined }));
    runLog      = [];
    runError    = '';
  }

  onDestroy(() => {
    if (pollingInterval) clearInterval(pollingInterval);
  });
</script>

<svelte:head>
  <title>Ingest Paper — Sophia Admin</title>
</svelte:head>

<div class="ingest-page">

  <!-- ── Progress breadcrumb ─────────────────────────────────────────── -->
  <nav class="breadcrumb" aria-label="Ingestion steps">
    {#each WIZARD_STEPS as step, i}
      {@const active = wizardStep === step}
      {@const past   = WIZARD_STEPS.indexOf(wizardStep) > i}
      <span class="crumb" class:active class:past aria-current={active ? 'step' : undefined}>
        <span class="crumb-num">{i + 1}</span>
        <span class="crumb-label">
          {#if step === 'source'}Source
          {:else if step === 'models'}Models
          {:else if step === 'confirm'}Confirm
          {:else if step === 'running'}Running
          {:else}Done{/if}
        </span>
      </span>
      {#if i < WIZARD_STEPS.length - 1}
        <span class="crumb-sep" aria-hidden="true">→</span>
      {/if}
    {/each}
  </nav>

  <!-- ══════════════════════════════════════════════════════════════════
       STEP 1 — Source
  ═══════════════════════════════════════════════════════════════════ -->
  {#if wizardStep === 'source'}
  <section class="card" aria-labelledby="step-source-heading">
    <div class="card-header">
      <span class="step-badge">Step 1 of 3</span>
      <h1 id="step-source-heading">Which paper do you want to ingest?</h1>
      <p class="subtitle">Paste a URL to a philosophical paper or encyclopedia entry. Sophia will fetch it, parse it, and run the full extraction pipeline.</p>
    </div>

    <div class="field">
      <label for="source-url">Source URL</label>
      <input
        id="source-url"
        type="url"
        bind:value={sourceUrl}
        placeholder="https://plato.stanford.edu/entries/consciousness/"
        class:error={!!urlError}
        autocomplete="off"
        spellcheck="false"
      />
      {#if urlError}<p class="field-error" role="alert">{urlError}</p>{/if}
      {#if slugPreview}<p class="field-hint">Will be stored as <code>{slugPreview}</code></p>{/if}
    </div>

    <div class="field">
      <label for="source-type">Source type</label>
      <select id="source-type" bind:value={sourceType}>
        {#each SOURCE_TYPES as t}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
      <p class="field-hint">This tells the extractor what shape to expect — SEP entries have a different structure to raw PDFs.</p>
    </div>

    <div class="card-actions">
      <button class="btn-primary" onclick={goToModels}>Choose AI models →</button>
    </div>
  </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════
       STEP 2 — Models
  ═══════════════════════════════════════════════════════════════════ -->
  {#if wizardStep === 'models'}
  <section class="card" aria-labelledby="step-models-heading">
    <div class="card-header">
      <span class="step-badge">Step 2 of 3</span>
      <h1 id="step-models-heading">Pick your AI models</h1>
      <p class="subtitle">The pipeline uses AI at three stages. Choose a model for each — faster/cheaper models work well for most papers; more powerful ones are worth it for dense or contested philosophy.</p>
    </div>

    <!-- Extract & relate -->
    <div class="model-stage">
      <div class="model-stage-header">
        <span class="stage-icon">📄</span>
        <div>
          <h2>Stages 1–2 · Extract claims &amp; map relations</h2>
          <p>Core work — reading passages, identifying claims, and drawing graph edges (supports / contradicts / depends_on etc.). Quality here matters most.</p>
        </div>
      </div>
      <p class="field-hint" style="margin: 0 0 var(--space-3)">
        Extract and relate share one pick here (including <strong>DeepSeek</strong>, OpenAI, Gemini, Groq, OpenRouter, etc.).
      </p>
      {#each CHAT_MODELS_BY_PROVIDER as group}
        <div class="model-provider-block">
          <h3 class="model-provider-title">{group.provider}</h3>
          <div class="model-grid">
            {#each group.models as m}
              <button
                class="model-card"
                class:selected={extractModel === m.id}
                onclick={() => { extractModel = m.id; relateModel = m.id; }}
                type="button"
              >
                {#if m.badge}
                  <span class="model-badge" style="background: {tierToken(m.tier)}">{m.badge}</span>
                {/if}
                <div class="model-name">{m.label}</div>
                <div class="model-cost">${(m.costPer1k * 1000).toFixed(2)} / M tokens</div>
                <div class="model-stars">
                  <span title="Quality">🧠 {stars(m.quality)}</span>
                  <span title="Speed">⚡ {stars(m.speed)}</span>
                </div>
                <div class="model-bestfor">{m.bestFor}</div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Group -->
    <div class="model-stage">
      <div class="model-stage-header">
        <span class="stage-icon">🗂️</span>
        <div>
          <h2>Stage 3 · Group into arguments</h2>
          <p>Clusters claims into named arguments and assigns roles. Lighter work — a fast model is usually fine.</p>
        </div>
      </div>
      {#each CHAT_MODELS_BY_PROVIDER as group}
        <div class="model-provider-block">
          <h3 class="model-provider-title">{group.provider}</h3>
          <div class="model-grid">
            {#each group.models as m}
              <button
                class="model-card"
                class:selected={groupModel === m.id}
                onclick={() => groupModel = m.id}
                type="button"
              >
                {#if m.badge}
                  <span class="model-badge" style="background: {tierToken(m.tier)}">{m.badge}</span>
                {/if}
                <div class="model-name">{m.label}</div>
                <div class="model-cost">${(m.costPer1k * 1000).toFixed(2)} / M tokens</div>
                <div class="model-stars">
                  <span>🧠 {stars(m.quality)}</span>
                  <span>⚡ {stars(m.speed)}</span>
                </div>
                <div class="model-bestfor">{m.bestFor}</div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Embed — Vertex / Google / Voyage -->
    <div class="model-stage">
      <div class="model-stage-header">
        <span class="stage-icon">🔢</span>
        <div>
          <h2>Stage 4 · Embed claims</h2>
          <p>
            Choose an embedding model id for routing / BYOK (e.g. <strong>Voyage 4</strong> or <strong>Vertex text-embedding-005</strong>).
            The live pipeline still follows your server Restormel / env defaults unless wired to this selection.
          </p>
        </div>
      </div>
      {#each EMBEDDING_MODELS_BY_PROVIDER as group}
        <div class="model-provider-block">
          <h3 class="model-provider-title">{group.provider}</h3>
          <div class="model-grid">
            {#each group.models as m}
              <button
                class="model-card"
                class:selected={embedModel === m.id}
                onclick={() => embedModel = m.id}
                type="button"
              >
                <div class="model-name">{m.label}</div>
                <div class="model-cost">${(m.costPer1k * 1000).toFixed(2)} / M tokens</div>
                <div class="model-stars">
                  <span>🧠 {stars(m.quality)}</span>
                  <span>⚡ {stars(m.speed)}</span>
                </div>
                <div class="model-bestfor">{m.bestFor}</div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Validate (optional) -->
    <div class="model-stage">
      <div class="model-stage-header">
        <span class="stage-icon">✅</span>
        <div>
          <h2>Stage 5 · Validate <span class="optional-tag">optional</span></h2>
          <p>Cross-checks faithfulness, logical coherence, and role clarity. Adds time and cost — skip for fast ingestion, run for anything requiring high confidence.</p>
        </div>
      </div>
      <label class="toggle-row">
        <input type="checkbox" bind:checked={runValidation} />
        <span>Run validation after ingestion</span>
      </label>
      {#if runValidation}
        <p class="field-hint" style="margin: var(--space-2) 0 var(--space-3)">
          Any chat-capable model from the catalog — not limited to Gemini.
        </p>
        {#each CHAT_MODELS_BY_PROVIDER as group}
          <div class="model-provider-block">
            <h3 class="model-provider-title">{group.provider}</h3>
            <div class="model-grid" style="margin-top: var(--space-2)">
              {#each group.models as m}
                <button
                  class="model-card"
                  class:selected={validateModel === m.id}
                  onclick={() => validateModel = m.id}
                  type="button"
                >
                  {#if m.badge}
                    <span class="model-badge" style="background: {tierToken(m.tier)}">{m.badge}</span>
                  {/if}
                  <div class="model-name">{m.label}</div>
                  <div class="model-cost">${(m.costPer1k * 1000).toFixed(2)} / M tokens</div>
                  <div class="model-stars">
                    <span>🧠 {stars(m.quality)}</span>
                    <span>⚡ {stars(m.speed)}</span>
                  </div>
                  <div class="model-bestfor">{m.bestFor}</div>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="cost-estimate">
      <span>Estimated cost: <strong>{estimateCost()}</strong></span>
      <span>Estimated time: <strong>{estimateTime()}</strong></span>
    </div>

    <div class="card-actions">
      <button class="btn-ghost" onclick={goBack}>← Back</button>
      <button class="btn-primary" onclick={goToConfirm}>Review &amp; confirm →</button>
    </div>
  </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════
       STEP 3 — Confirm
  ═══════════════════════════════════════════════════════════════════ -->
  {#if wizardStep === 'confirm'}
  <section class="card" aria-labelledby="step-confirm-heading">
    <div class="card-header">
      <span class="step-badge">Step 3 of 3</span>
      <h1 id="step-confirm-heading">Ready to ingest</h1>
      <p class="subtitle">Review your choices, then start the pipeline.</p>
    </div>

    <dl class="summary">
      <div class="summary-row">
        <dt>Source URL</dt>
        <dd><a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceUrl}</a></dd>
      </div>
      <div class="summary-row">
        <dt>Source type</dt>
        <dd>{SOURCE_TYPES.find(t => t.value === sourceType)?.label}</dd>
      </div>
      <div class="summary-row">
        <dt>Extract &amp; relate model</dt>
        <dd>{getModel(extractModel)?.label}</dd>
      </div>
      <div class="summary-row">
        <dt>Grouping model</dt>
        <dd>{getModel(groupModel)?.label}</dd>
      </div>
      <div class="summary-row">
        <dt>Embeddings</dt>
        <dd>{getModel(embedModel)?.label ?? embedModel}</dd>
      </div>
      <div class="summary-row">
        <dt>Validation</dt>
        <dd>{runValidation ? getModel(validateModel)?.label : 'Skipped'}</dd>
      </div>
      <div class="summary-row highlight">
        <dt>Est. cost</dt>
        <dd>{estimateCost()}</dd>
      </div>
      <div class="summary-row highlight">
        <dt>Est. time</dt>
        <dd>{estimateTime()}</dd>
      </div>
    </dl>

    {#if runError}
      <div class="run-error" role="alert">⚠ {runError}</div>
    {/if}

    <div class="card-actions">
      <button class="btn-ghost" onclick={goBack}>← Back</button>
      <button class="btn-launch" onclick={startRun}>Start ingestion</button>
    </div>
  </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════
       STEP 4/5 — Running / Done
  ═══════════════════════════════════════════════════════════════════ -->
  {#if wizardStep === 'running' || wizardStep === 'done'}
  <section class="card" aria-labelledby="step-running-heading">
    <div class="card-header">
      <span class="step-badge">{wizardStep === 'done' ? '✓ Complete' : 'Running'}</span>
      <h1 id="step-running-heading">
        {wizardStep === 'done' ? 'Ingestion complete' : 'Ingesting…'}
      </h1>
      {#if slugPreview}
        <p class="subtitle">Source: <code>{slugPreview}</code></p>
      {/if}
    </div>

    <ol class="pipeline">
      {#each stages as stage}
        {@const skip = stage.key === 'validate' && !runValidation}
        <li
          class="pipeline-stage"
          class:s-idle={stage.status === 'idle' && !skip}
          class:s-running={stage.status === 'running'}
          class:s-done={stage.status === 'done'}
          class:s-error={stage.status === 'error'}
          class:s-skipped={skip}
        >
          <span class="pipeline-icon" aria-hidden="true">
            {#if skip}—
            {:else if stage.status === 'done'}✓
            {:else if stage.status === 'error'}✗
            {:else if stage.status === 'running'}<span class="spinner">◌</span>
            {:else}○{/if}
          </span>
          <div class="pipeline-body">
            <div class="pipeline-label">
              <strong>{stage.label}</strong>
              {#if stage.usesModel && stage.key === 'extract'}
                <span class="model-pill">{getModel(extractModel)?.label}</span>
              {:else if stage.usesModel && stage.key === 'relate'}
                <span class="model-pill">{getModel(relateModel)?.label}</span>
              {:else if stage.usesModel && stage.key === 'group'}
                <span class="model-pill">{getModel(groupModel)?.label}</span>
              {:else if stage.usesModel && stage.key === 'validate'}
                <span class="model-pill">{getModel(validateModel)?.label}</span>
              {:else if stage.key === 'embed'}
                <span class="model-pill fixed">text-embedding-005</span>
              {/if}
            </div>
            <p class="pipeline-desc">{stage.description}</p>
            {#if stage.result}
              <p class="pipeline-result">{stage.result}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>

    {#if runLog.length > 0}
      <details class="log-panel" open={wizardStep !== 'done'}>
        <summary>Run log ({runLog.length} lines)</summary>
        <pre class="log-output">{runLog.join('\n')}</pre>
      </details>
    {/if}

    {#if runError}
      <div class="run-error" role="alert">⚠ {runError}</div>
    {/if}

    {#if wizardStep === 'done'}
      <div class="card-actions">
        <a class="btn-ghost" href="/admin/review">Review ingested claims →</a>
        <button class="btn-primary" onclick={resetWizard}>Ingest another paper</button>
      </div>
    {/if}
  </section>
  {/if}

</div>

<style>
  /* ── Layout ──────────────────────────────────────────────────────── */
  .ingest-page {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4) var(--space-7);
    font-family: var(--font-ui);
  }

  /* ── Breadcrumb ──────────────────────────────────────────────────── */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    font-size: var(--text-ui);
    color: var(--color-dim);
  }
  .crumb { display: flex; align-items: center; gap: 6px; }
  .crumb-num {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 50%;
    border: 1px solid currentColor;
    display: grid;
    place-items: center;
    font-size: 0.7rem;
    font-weight: 600;
    flex-shrink: 0;
  }
  .crumb.active { color: var(--color-sage); font-weight: 600; }
  .crumb.active .crumb-num {
    background: var(--color-sage);
    color: var(--color-bg);
    border-color: var(--color-sage);
  }
  .crumb.past { color: var(--color-muted); }
  .crumb.past .crumb-num {
    background: var(--color-surface-raised);
    border-color: transparent;
  }
  .crumb-sep { color: var(--color-border); margin: 0 2px; }

  /* ── Card ────────────────────────────────────────────────────────── */
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }
  .card-header { margin-bottom: var(--space-4); }
  .step-badge {
    display: inline-block;
    font-size: var(--text-label);
    font-weight: 700;
    color: var(--color-sage);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: var(--space-2);
  }
  .card-header h1 {
    font-family: var(--font-display);
    font-size: var(--text-d3);
    font-weight: 600;
    margin: 0 0 var(--space-2);
    color: var(--color-text);
    line-height: var(--leading-card);
  }
  .subtitle {
    color: var(--color-muted);
    margin: 0;
    line-height: var(--leading-ui);
    font-size: 0.875rem;
  }
  .card-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  /* ── Buttons ─────────────────────────────────────────────────────── */
  .btn-primary,
  .btn-ghost,
  .btn-launch {
    padding: 0.5rem 1.125rem;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity var(--transition-fast);
    text-decoration: none;
    display: inline-block;
  }
  .btn-primary {
    background: var(--color-sage);
    color: var(--color-bg);
  }
  .btn-primary:hover { opacity: 0.85; }

  .btn-launch {
    background: var(--color-teal);
    color: var(--color-bg);
    font-size: 0.9rem;
    padding: 0.625rem 1.5rem;
  }
  .btn-launch:hover { opacity: 0.85; }

  .btn-ghost {
    background: transparent;
    color: var(--color-muted);
    border: 1px solid var(--color-border);
  }
  .btn-ghost:hover {
    background: var(--color-surface-raised);
    color: var(--color-text);
  }

  /* ── Fields ──────────────────────────────────────────────────────── */
  .field { margin-bottom: var(--space-3); }
  .field label {
    display: block;
    font-size: var(--text-ui);
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--color-muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .field input,
  .field select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: 0.9rem;
    background: var(--color-surface-sunken);
    color: var(--color-text);
    box-sizing: border-box;
    transition: border-color var(--transition-fast);
  }
  .field input:focus,
  .field select:focus {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    border-color: transparent;
  }
  .field input.error { border-color: var(--color-coral); }
  .field-error {
    color: var(--color-coral);
    font-size: var(--text-meta);
    margin: 4px 0 0;
  }
  .field-hint {
    color: var(--color-dim);
    font-size: var(--text-meta);
    margin: 4px 0 0;
  }
  .field-hint code {
    font-family: var(--font-ui);
    color: var(--color-amber);
  }

  /* ── Model stage blocks ──────────────────────────────────────────── */
  .model-stage {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .model-stage-header {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin-bottom: var(--space-2);
  }
  .stage-icon { font-size: 1.25rem; flex-shrink: 0; line-height: 1; margin-top: 2px; }
  .model-stage-header h2 {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--color-text);
    margin: 0 0 4px;
  }
  .model-stage-header p {
    color: var(--color-muted);
    font-size: var(--text-meta);
    margin: 0;
    line-height: var(--leading-ui);
  }
  .optional-tag {
    font-weight: 400;
    color: var(--color-dim);
    font-size: 0.75rem;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
    color: var(--color-muted);
    cursor: pointer;
  }
  .toggle-row input[type="checkbox"] { accent-color: var(--color-sage); cursor: pointer; }

  /* ── Model cards grid ────────────────────────────────────────────── */
  .model-provider-block {
    margin-bottom: var(--space-4);
  }
  .model-provider-block:last-child {
    margin-bottom: 0;
  }
  .model-provider-title {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-dim);
    margin: 0 0 var(--space-2);
  }
  .model-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-2);
  }
  .model-card {
    position: relative;
    text-align: left;
    background: var(--color-surface-sunken);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-2) var(--space-2);
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }
  .model-card:hover {
    border-color: var(--color-sage-border);
    background: var(--color-surface-raised);
  }
  .model-card.selected {
    border-color: var(--color-sage);
    background: var(--color-sage-bg);
  }
  .model-card:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }
  .model-badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--color-bg);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .model-name {
    font-size: var(--text-ui);
    font-weight: 700;
    color: var(--color-text);
    margin-bottom: 3px;
  }
  .model-cost {
    font-size: var(--text-meta);
    color: var(--color-amber);
    margin-bottom: 4px;
  }
  .model-stars {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-meta);
    color: var(--color-muted);
    margin-bottom: 4px;
    font-family: var(--font-ui);
  }
  .model-bestfor {
    font-size: var(--text-meta);
    color: var(--color-dim);
    line-height: 1.3;
  }

  /* ── Cost estimate bar ───────────────────────────────────────────── */
  .cost-estimate {
    display: flex;
    gap: var(--space-4);
    font-size: 0.875rem;
    color: var(--color-muted);
    padding: var(--space-3);
    background: var(--color-surface-sunken);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    margin-top: var(--space-3);
  }
  .cost-estimate strong { color: var(--color-text); }

  /* ── Summary (confirm step) ──────────────────────────────────────── */
  .summary { margin: 0; }
  .summary-row {
    display: flex;
    gap: var(--space-3);
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--color-border);
  }
  .summary-row:last-child { border-bottom: none; }
  .summary-row.highlight { background: var(--color-surface-raised); margin: 0 calc(-1 * var(--space-5)); padding: 0.625rem var(--space-5); }
  .summary-row dt {
    width: 10rem;
    flex-shrink: 0;
    font-size: var(--text-ui);
    font-weight: 600;
    color: var(--color-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .summary-row dd {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text);
    word-break: break-all;
  }
  .summary-row dd a {
    color: var(--color-blue);
    text-decoration: none;
  }
  .summary-row dd a:hover { text-decoration: underline; }
  .summary-row.highlight dd { color: var(--color-sage); font-weight: 600; }

  /* ── Pipeline ────────────────────────────────────────────────────── */
  .pipeline {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .pipeline-stage {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
    transition: background var(--transition-fast);
  }
  .pipeline-stage:last-child { border-bottom: none; }
  .pipeline-stage.s-running { background: var(--color-surface-raised); margin: 0 calc(-1 * var(--space-5)); padding: var(--space-2) var(--space-5); }

  .pipeline-icon {
    width: 1.5rem;
    flex-shrink: 0;
    text-align: center;
    font-size: 0.875rem;
    margin-top: 2px;
    color: var(--color-dim);
  }
  .s-done   .pipeline-icon { color: var(--color-sage); }
  .s-error  .pipeline-icon { color: var(--color-coral); }
  .s-running .pipeline-icon { color: var(--color-amber); }
  .s-skipped .pipeline-icon { color: var(--color-border); }

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }

  .pipeline-body { flex: 1; min-width: 0; }
  .pipeline-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: 2px;
  }
  .pipeline-label strong {
    font-size: 0.875rem;
    color: var(--color-text);
  }
  .s-skipped .pipeline-label strong { color: var(--color-dim); }
  .pipeline-desc {
    font-size: var(--text-meta);
    color: var(--color-dim);
    margin: 0 0 2px;
    line-height: var(--leading-ui);
  }
  .pipeline-result {
    font-size: var(--text-meta);
    color: var(--color-sage);
    margin: 4px 0 0;
  }

  .model-pill {
    display: inline-block;
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--color-sage-bg);
    color: var(--color-sage);
    border: 1px solid var(--color-sage-border);
    font-weight: 600;
  }
  .model-pill.fixed {
    background: var(--color-blue-bg);
    color: var(--color-blue);
    border-color: var(--color-blue-border);
  }

  /* ── Log panel ───────────────────────────────────────────────────── */
  .log-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-top: var(--space-3);
  }
  .log-panel summary {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-meta);
    color: var(--color-dim);
    cursor: pointer;
    user-select: none;
  }
  .log-panel summary:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }
  .log-output {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 280px;
    overflow-y: auto;
    background: var(--color-surface-sunken);
    border-top: 1px solid var(--color-border);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  /* ── Error banner ────────────────────────────────────────────────── */
  .run-error {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-coral-bg);
    border: 1px solid var(--color-coral-border);
    border-radius: var(--radius-md);
    color: var(--color-coral);
    font-size: 0.875rem;
  }
</style>
