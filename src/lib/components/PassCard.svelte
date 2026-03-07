<script lang="ts">
  import PassBadge from './PassBadge.svelte';

  interface Props {
    pass: 'analysis' | 'critique' | 'synthesis';
    content: string;
    streaming?: boolean;
  }

  let { pass, content, streaming = false }: Props = $props();

  const titles: Record<string, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
  };
</script>

<article class="card card-{pass}" class:streaming>
  <div class="accent-bar" aria-hidden="true"></div>

  <div class="card-inner">
    <header class="card-header">
      <PassBadge {pass} />
      <h2 class="title">{titles[pass]}</h2>
    </header>

    <div class="content" class:streaming>
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
    font-family: var(--font-display);
    font-size: var(--text-d3);
    font-weight: 300;
    color: var(--color-text);
    margin: 0;
  }

  .content {
    font-family: var(--font-display);
    font-size: var(--text-body);
    color: var(--color-muted);
    line-height: 1.85;
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

  /* Prose styles for rendered markdown within content */
  .content :global(h1),
  .content :global(h2),
  .content :global(h3),
  .content :global(h4) {
    font-family: var(--font-display);
    font-weight: 400;
    color: var(--color-text);
    margin-top: var(--space-5);
    margin-bottom: var(--space-3);
    line-height: 1.3;
  }

  .content :global(h1:first-child),
  .content :global(h2:first-child),
  .content :global(h3:first-child) {
    margin-top: 0;
  }

  .content :global(h1) { font-size: 1.6rem; }
  .content :global(h2) {
    font-size: 1.25rem;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }
  .content :global(h2:first-child) { padding-top: 0; border-top: none; }
  .content :global(h3) { font-size: 1.05rem; }

  .content :global(p) {
    margin-bottom: var(--space-3);
    margin-top: 0;
  }

  .content :global(ul),
  .content :global(ol) {
    margin-bottom: var(--space-3);
    padding-left: var(--space-5);
  }

  .content :global(li) {
    margin-bottom: var(--space-2);
  }

  .content :global(strong) {
    font-weight: 600;
    color: var(--color-text);
  }

  .content :global(em) {
    font-style: italic;
  }

  .content :global(code) {
    font-family: var(--font-ui);
    font-size: 0.85em;
    color: var(--color-blue);
    background: var(--color-surface-raised);
    padding: 0.2em 0.45em;
    border-radius: 2px;
  }

  .content :global(blockquote) {
    border-left: 2px solid var(--color-sage);
    padding-left: var(--space-3);
    margin: var(--space-4) 0;
    color: var(--color-muted);
    font-style: italic;
  }

  .content :global(a) {
    color: var(--color-blue);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .content :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: var(--space-4) 0;
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
