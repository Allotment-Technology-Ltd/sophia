<script lang="ts">
  import { stoaConversationStore } from '$lib/stores/stoaConversation.svelte';

  let draft = $state('');
  let showDetails = $state(false);
  let goalDraft = $state('');
  let triggerDraft = $state('');
  let practiceDraft = $state('');
  let doneToday = $state(false);
  let doneTonight = $state(false);
  let doneWeek = $state(false);
  let hasAgentResponse = $derived(stoaConversationStore.messages.some((message) => message.role === 'agent'));

  const CONFIDENCE_LABEL: Record<string, string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  };

  function addProfile(kind: 'goals' | 'triggers' | 'practices'): void {
    if (kind === 'goals') {
      void stoaConversationStore.addProfileItem('goals', goalDraft);
      goalDraft = '';
      return;
    }
    if (kind === 'triggers') {
      void stoaConversationStore.addProfileItem('triggers', triggerDraft);
      triggerDraft = '';
      return;
    }
    void stoaConversationStore.addProfileItem('practices', practiceDraft);
    practiceDraft = '';
  }

  async function submit(): Promise<void> {
    const message = draft.trim();
    if (!message || stoaConversationStore.isLoading) return;
    draft = '';
    await stoaConversationStore.send(message);
  }
</script>

<svelte:head>
  <title>Stoa Dialogue | SOPHIA</title>
</svelte:head>

<main class="stoa-page">
  <section class="stoa-header">
    <h1>Stoa Dialogue (Mode 6)</h1>
    <p>A focused Stoic coach with practical next steps.</p>
  </section>

  <section class="stoa-meta" aria-live="polite">
    <span>Stance: {stoaConversationStore.currentStance}</span>
    {#if hasAgentResponse}
      <span>Sources: {stoaConversationStore.sourceClaims.length > 0 ? 'linked' : 'none'}</span>
      <span
        class="confidence-pill {stoaConversationStore.groundingConfidence}"
        >Grounding confidence: {CONFIDENCE_LABEL[stoaConversationStore.groundingConfidence]}</span
      >
    {/if}
  </section>

  {#if hasAgentResponse && stoaConversationStore.groundingMode !== 'graph_dense'}
    <p class="grounding-note {stoaConversationStore.groundingMode === 'degraded_none' ? 'warn' : 'info'}">
      {stoaConversationStore.groundingMode === 'lexical_fallback'
        ? 'Using backup source retrieval for this turn.'
        : 'Sources unavailable right now; response may be less grounded.'}
    </p>
  {/if}

  <section class="stoa-thread">
    {#if stoaConversationStore.messages.length === 0}
      <p class="empty">Start with a real situation, dilemma, or emotional challenge.</p>
    {/if}
    {#each stoaConversationStore.messages as message (message.id)}
      <article class="message {message.role}">
        <header>{message.role === 'user' ? 'You' : 'Stoa'}</header>
        <p>{message.content}</p>
      </article>
    {/each}
  </section>

  {#if stoaConversationStore.actionLoop}
    <section class="action-loop" aria-label="Action loop check-ins">
      <h2>Action Loop</h2>
      <article class="loop-card">
        <h3>Today</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneToday} /> Done</label>
        <p>{stoaConversationStore.actionLoop.today}</p>
      </article>
      <article class="loop-card">
        <h3>Tonight</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneTonight} /> Done</label>
        <p>{stoaConversationStore.actionLoop.tonight}</p>
      </article>
      <article class="loop-card">
        <h3>This week</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneWeek} /> Done</label>
        <p>{stoaConversationStore.actionLoop.thisWeek}</p>
      </article>
      <p class="follow-up">Follow-up: {stoaConversationStore.actionLoop.followUpPrompt}</p>
    </section>
  {/if}

  <form class="composer" onsubmit={async (event) => { event.preventDefault(); await submit(); }}>
    <label for="stoa-message">Message</label>
    <textarea
      id="stoa-message"
      bind:value={draft}
      rows="4"
      placeholder="Describe what happened and what you are trying to navigate."
      disabled={stoaConversationStore.isLoading}
    ></textarea>
    <div class="actions">
      <button type="button" class="secondary" onclick={() => stoaConversationStore.reset()}>
        Reset
      </button>
      <button type="submit" class="primary" disabled={stoaConversationStore.isLoading || !draft.trim()}>
        {stoaConversationStore.isLoading ? 'Responding...' : 'Send'}
      </button>
    </div>
    {#if stoaConversationStore.error}
      <p class="error">{stoaConversationStore.error}</p>
    {/if}
  </form>

  <section class="details-card">
    <button
      type="button"
      class="secondary details-toggle"
      aria-expanded={showDetails}
      onclick={() => (showDetails = !showDetails)}
    >
      {showDetails ? 'Hide details' : 'Show details'}
    </button>

    {#if showDetails}
      <div class="details-grid">
        <article class="detail-panel">
          <h3>Personal Memory</h3>
          <div class="memory-input">
            <input bind:value={goalDraft} placeholder="Add goal" />
            <button type="button" class="secondary" onclick={() => addProfile('goals')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.goals.join(' | ') || '(none yet)'}</p>
          <div class="memory-input">
            <input bind:value={triggerDraft} placeholder="Add trigger" />
            <button type="button" class="secondary" onclick={() => addProfile('triggers')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.triggers.join(' | ') || '(none yet)'}</p>
          <div class="memory-input">
            <input bind:value={practiceDraft} placeholder="Add practice" />
            <button type="button" class="secondary" onclick={() => addProfile('practices')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.practices.join(' | ') || '(none yet)'}</p>
        </article>

        {#if stoaConversationStore.sourceClaims.length > 0}
          <article class="detail-panel" aria-label="Grounding sources">
            <h3>Sources</h3>
            {#each stoaConversationStore.sourceClaims as source (source.claimId)}
              <p class="source-line">
                {source.sourceText}
                <span>{source.sourceAuthor} - {source.sourceWork}</span>
              </p>
            {/each}
          </article>
        {/if}

        {#if stoaConversationStore.citationQuality.length > 0}
          <article class="detail-panel">
            <h3>Citation Quality</h3>
            {#each stoaConversationStore.citationQuality as quality (quality.claimId)}
              <p class="citation-line">
                {quality.claimId} - overlap {quality.quoteOverlap.toFixed(2)}, provenance {quality.provenanceConfidence.toFixed(2)}, confidence {quality.confidence}
              </p>
            {/each}
          </article>
        {/if}
      </div>
    {/if}
  </section>
</main>

<style>
  .stoa-page {
    max-width: 840px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-4);
  }

  .stoa-header h1 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-d2);
  }

  .stoa-header p {
    margin: 0;
    color: var(--color-muted);
  }

  .stoa-meta {
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-meta);
    color: var(--color-dim);
    flex-wrap: wrap;
  }

  .confidence-pill {
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border);
  }

  .confidence-pill.high {
    color: var(--color-sage-border);
    border-color: var(--color-sage-border);
  }

  .confidence-pill.medium {
    color: var(--color-copper);
    border-color: var(--color-copper);
  }

  .confidence-pill.low {
    color: var(--color-coral);
    border-color: var(--color-coral);
  }

  .grounding-note {
    margin: 0;
    font-size: var(--text-meta);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
  }

  .grounding-note.info {
    color: var(--color-dim);
    background: var(--color-surface);
  }

  .grounding-note.warn {
    color: var(--color-copper);
    background: color-mix(in srgb, var(--color-copper) 8%, var(--color-bg));
  }

  .stoa-thread {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--color-surface);
    min-height: 280px;
    display: grid;
    gap: var(--space-3);
  }

  .message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface-raised);
  }

  .message.user {
    border-color: var(--color-blue-border);
    background: var(--color-blue-bg);
  }

  .message.agent {
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }

  .message header {
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
    color: var(--color-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .message p {
    margin: 0;
    white-space: pre-wrap;
    line-height: var(--leading-ui);
  }

  .empty {
    margin: 0;
    color: var(--color-dim);
  }

  .composer {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .action-loop {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .action-loop h2 {
    margin: 0;
    font-size: var(--text-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .loop-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .loop-card h3,
  .loop-card p {
    margin: 0;
  }

  .loop-check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .follow-up {
    margin: 0;
    color: var(--color-dim);
    font-size: var(--text-meta);
  }

  .details-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .details-toggle {
    width: fit-content;
  }

  .details-grid {
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .detail-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .detail-panel h3,
  .detail-panel p {
    margin: 0;
  }

  .memory-input {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .memory-input input {
    flex: 1;
    min-height: 36px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    padding: var(--space-2) var(--space-3);
  }

  .source-line,
  .citation-line {
    line-height: var(--leading-ui);
    font-size: var(--text-meta);
  }

  .source-line span {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .composer label {
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .composer textarea {
    width: 100%;
    background: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    resize: vertical;
    min-height: 96px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .actions button {
    min-height: 44px;
    padding: 8px 16px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-size: var(--text-ui);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .actions button:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .actions .primary {
    background: var(--color-sage);
    color: #10140f;
    border-color: var(--color-sage-border);
  }

  .actions .primary:hover:enabled {
    background: #92b896;
  }

  .actions .secondary {
    background: transparent;
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .actions .secondary:hover:enabled {
    background: var(--color-surface-raised);
  }

  .error {
    margin: 0;
    color: var(--color-coral);
    font-size: var(--text-meta);
  }
</style>

