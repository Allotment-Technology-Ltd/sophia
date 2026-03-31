<script lang="ts">
  interface Props {
    count: number;
    limit?: number;
  }

  let { count, limit = 3 }: Props = $props();

  const atLimit = $derived(count >= limit);
  const remaining = $derived(Math.max(0, limit - count));

  // Track previous count to detect when a new question is added
  let prevCount = $state(0);
  let animatingDot = $state<number | null>(null);

  $effect(() => {
    const current = count;
    if (current > prevCount) {
      animatingDot = current;
      const t = setTimeout(() => { animatingDot = null; }, 600);
      prevCount = current;
      return () => clearTimeout(t);
    }
    prevCount = current;
  });
</script>

<div class="counter" aria-label="Question {count} of {limit}" aria-live="polite">
  <div class="dots" aria-hidden="true">
    {#each Array.from({ length: limit }, (_, i) => i + 1) as dotIdx}
      <div
        class="dot"
        class:filled={dotIdx <= count}
        class:animating={animatingDot === dotIdx}
      ></div>
    {/each}
  </div>

  <span class="counter-label">
    {#if atLimit}
      Inquiry complete
    {:else}
      {remaining} {remaining === 1 ? 'question' : 'questions'} remaining
    {/if}
  </span>
</div>

<style>
  .counter {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .dots {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid var(--color-dim);
    transition: background 300ms ease, border-color 300ms ease;
  }

  .dot.filled {
    background: var(--color-copper);
    border-color: var(--color-copper);
  }

  .dot.animating {
    animation: dotFill 500ms ease both;
  }

  .counter-label {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  @keyframes dotFill {
    0%   { transform: scale(0.5); }
    50%  { transform: scale(1.5); }
    100% { transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      transition: none;
    }
    .dot.animating {
      animation: none;
    }
  }
</style>
