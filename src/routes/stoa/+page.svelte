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
  </section>

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

