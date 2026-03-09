<script lang="ts">
  import DialecticalTriangle from './DialecticalTriangle.svelte';

  interface Props {
    currentPass?: string;
    statusText?: string;
    completedPasses?: string[];
  }

  let { currentPass = '', statusText = 'Thinking…', completedPasses = [] }: Props = $props();
</script>

<div class="loading-screen" aria-live="polite" aria-label="Analysis in progress">
  <DialecticalTriangle
    mode="loading"
    {currentPass}
    {completedPasses}
    size={240}
  />

  <p class="status-text">{statusText}</p>
</div>

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - var(--nav-height));
    padding: var(--space-5);
  }

  .status-text {
    margin-top: 32px;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    text-align: center;
  }
</style>
