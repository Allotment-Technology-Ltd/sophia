<script lang="ts">
  import { stoaConversationStore } from '$lib/stores/stoaConversation.svelte';

  let draft = $state('');

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
    <p>Adaptive Stoic conversation with stance detection, grounding, and streaming responses.</p>
  </section>

  <section class="stoa-meta" aria-live="polite">
    <span>Stance: {stoaConversationStore.currentStance}</span>
    <span>Escalation: {stoaConversationStore.escalated ? 'flagged' : 'none'}</span>
    <span>Sources: {stoaConversationStore.sourceClaims.length}</span>
    <span>Grounding: {stoaConversationStore.groundingMode}</span>
    <span>Grounding confidence: {stoaConversationStore.groundingConfidence}</span>
  </section>

  {#if stoaConversationStore.escalated && stoaConversationStore.escalationReasons.length > 0}
    <p class="grounding-warning">Escalation reasons: {stoaConversationStore.escalationReasons.join(', ')}</p>
  {/if}

  {#if stoaConversationStore.groundingWarning}
    <p class="grounding-warning">{stoaConversationStore.groundingWarning}</p>
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

  {#if stoaConversationStore.sourceClaims.length > 0}
    <section class="sources-panel" aria-label="Grounding sources">
      <h2>Grounding Sources</h2>
      {#each stoaConversationStore.sourceClaims as source (source.claimId)}
        <article class="source-card">
          <p class="source-text">{source.sourceText}</p>
          <p class="source-meta">
            <span>{source.sourceAuthor}</span>
            <span>{source.sourceWork}</span>
            <span>score {source.relevanceScore.toFixed(2)}</span>
          </p>
        </article>
      {/each}
      {#if stoaConversationStore.citationQuality.length > 0}
        <div class="citation-panel">
          <h3>Citation Quality</h3>
          {#each stoaConversationStore.citationQuality as quality (quality.claimId)}
            <p class="citation-line">
              <span>{quality.claimId}</span>
              <span>quote overlap {quality.quoteOverlap.toFixed(2)}</span>
              <span>provenance {quality.provenanceConfidence.toFixed(2)}</span>
              <span>confidence {quality.confidence}</span>
            </p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if stoaConversationStore.actionLoop}
    <section class="action-loop" aria-label="Action loop check-ins">
      <h2>Action Loop</h2>
      <article class="loop-card">
        <h3>Today</h3>
        <p>{stoaConversationStore.actionLoop.today}</p>
      </article>
      <article class="loop-card">
        <h3>Tonight</h3>
        <p>{stoaConversationStore.actionLoop.tonight}</p>
      </article>
      <article class="loop-card">
        <h3>This week</h3>
        <p>{stoaConversationStore.actionLoop.thisWeek}</p>
      </article>
      <p class="follow-up">Follow-up: {stoaConversationStore.actionLoop.followUpPrompt}</p>
    </section>
  {/if}

  {#if stoaConversationStore.profile}
    <section class="action-loop" aria-label="Personal memory profile">
      <h2>Personal Memory</h2>
      <p class="follow-up"><strong>Goals:</strong> {stoaConversationStore.profile.goals.join(' | ') || '(none yet)'}</p>
      <p class="follow-up"><strong>Triggers:</strong> {stoaConversationStore.profile.triggers.join(' | ') || '(none yet)'}</p>
      <p class="follow-up"><strong>Practices:</strong> {stoaConversationStore.profile.practices.join(' | ') || '(none yet)'}</p>
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

  .grounding-warning {
    margin: 0;
    color: var(--color-copper);
    font-size: var(--text-meta);
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

  .follow-up {
    margin: 0;
    color: var(--color-dim);
    font-size: var(--text-meta);
  }

  .sources-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
  }

  .sources-panel h2 {
    margin: 0;
    font-size: var(--text-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .source-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .source-text {
    margin: 0;
    line-height: var(--leading-ui);
    color: var(--color-text);
  }

  .source-meta {
    margin: 0;
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    color: var(--color-dim);
    font-size: var(--text-meta);
  }

  .citation-panel {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .citation-panel h3 {
    margin: 0;
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .citation-line {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
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

