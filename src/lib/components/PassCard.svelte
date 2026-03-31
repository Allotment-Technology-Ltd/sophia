<script lang="ts">
  import PassBadge from './PassBadge.svelte';

  interface Props {
    pass: 'analysis' | 'critique' | 'synthesis';
    content: string;
    streaming?: boolean;
  }

  let { pass, content, streaming = false }: Props = $props();

  const titles: Record<string, string> = {
    analysis: 'Foundations',
    critique: 'Challenges',
    synthesis: 'Resolution',
  };
</script>

<article class="card card-{pass}" class:streaming>
  <div class="accent-bar" aria-hidden="true"></div>

  <div class="card-inner">
    <header class="card-header">
      <PassBadge {pass} />
      <h2 class="title">{titles[pass]}</h2>
    </header>

    <div class="content reasoning-prose" class:streaming>
      {@html content}
    </div>
  </div>
</article>

<style>
  .card {
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    display: flex;
    animation: fadeInUp var(--transition-slow) ease both;
  }

  .accent-bar {
    width: 2px;
    border-radius: 2px 0 0 2px;
    flex-shrink: 0;
    align-self: stretch;
  }

  .card-analysis .accent-bar { background: var(--color-sage); }
  .card-critique .accent-bar { background: var(--color-copper); }
  .card-synthesis .accent-bar { background: var(--color-blue); }

  .card-inner {
    flex: 1;
    padding: 32px;
    min-width: 0;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .title {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: var(--text-d3);
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
  }

  .content {
    font-size: var(--text-body);
    word-break: break-word;
  }

  /* Streaming cursor via ::after on content wrapper */
  .content.streaming::after {
    content: '';
    display: inline-block;
    width: 2px;
    height: 1.1em;
    background: var(--color-muted);
    margin-left: 3px;
    vertical-align: text-bottom;
    animation: cursorBlink 1s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }

    .content.streaming::after {
      animation: none;
      opacity: 1;
    }
  }
</style>
