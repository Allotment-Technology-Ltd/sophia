<script lang="ts">
  interface Props {
    questions: string[];
    onSelect?: (question: string) => void;
  }

  let { questions, onSelect }: Props = $props();
</script>

{#if questions.length > 0}
  <div class="hints-wrap" role="group" aria-label="Suggested follow-up questions">
    <span class="hints-label">Continue exploring</span>
    <div class="hints-list">
      {#each questions as q, i}
        <button
          class="hint-pill"
          onclick={() => onSelect?.(q)}
          style="animation-delay: {i * 80}ms"
        >
          <span class="pill-text">{q}</span>
          <span class="pill-arrow" aria-hidden="true">→</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .hints-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hints-label {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .hints-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hint-pill {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 0.9rem;
    font-style: italic;
    font-weight: 400;
    color: var(--color-muted);
    transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
    animation: hintFadeIn 300ms ease both;
  }

  .hint-pill:hover {
    border-color: var(--color-sage-border);
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  .hint-pill:focus {
    outline: 2px solid var(--color-sage);
    outline-offset: 2px;
  }

  .pill-text {
    flex: 1;
    min-width: 0;
  }

  .pill-arrow {
    font-family: var(--font-ui);
    font-style: normal;
    font-size: 0.75rem;
    color: var(--color-muted);
    flex-shrink: 0;
    transition: color var(--transition-fast);
  }

  .hint-pill:hover .pill-arrow {
    color: var(--color-sage);
  }

  @keyframes hintFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .hint-pill {
      animation: none;
    }
  }
</style>
