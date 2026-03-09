<script lang="ts">
  import { getIdToken } from '$lib/firebase';

  interface Props {
    queryId?: string;
    passType: 'analysis' | 'critique' | 'synthesis';
  }

  let { queryId, passType }: Props = $props();
  let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let selected = $state<'up' | 'down' | null>(null);

  async function submitFeedback(rating: 'up' | 'down') {
    if (!queryId || status === 'saving') return;
    status = 'saving';
    selected = rating;

    try {
      const token = await getIdToken();
      if (!token) throw new Error('missing auth');
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ queryId, passType, rating })
      });
      if (!res.ok) throw new Error('feedback failed');
      status = 'saved';
    } catch {
      status = 'error';
    }
  }
</script>

<div class="feedback" aria-label="Pass feedback">
  <span>Helpful?</span>
  <button
    type="button"
    class:active={selected === 'up'}
    aria-pressed={selected === 'up'}
    onclick={() => submitFeedback('up')}
    disabled={!queryId || status === 'saving' || status === 'saved'}
    title="Thumbs up"
  >
    +
  </button>
  <button
    type="button"
    class:active={selected === 'down'}
    aria-pressed={selected === 'down'}
    onclick={() => submitFeedback('down')}
    disabled={!queryId || status === 'saving' || status === 'saved'}
    title="Thumbs down"
  >
    -
  </button>
  {#if status === 'saved'}
    <small>Thanks</small>
  {:else if status === 'error'}
    <small>Retry</small>
  {/if}
</div>

<style>
  .feedback {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    color: var(--color-dim);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .feedback button {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: 999px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1;
  }

  .feedback button.active {
    border-color: var(--color-sage-border);
    background: var(--color-surface-raised);
  }

  .feedback button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .feedback small {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.72rem;
    color: var(--color-muted);
  }
</style>
