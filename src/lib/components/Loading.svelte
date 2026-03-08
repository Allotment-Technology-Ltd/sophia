<script lang="ts">
  import PassTracker from './PassTracker.svelte';

  interface Props {
    currentPass?: string;
    statusText?: string;
    completedPasses?: string[];
  }

  let { currentPass = '', statusText = 'Thinking…', completedPasses = [] }: Props = $props();
</script>

<div class="loading-screen" aria-live="polite" aria-label="Analysis in progress">
  <div class="orbital-wrap">
    <!-- SVG orbital rings -->
    <svg
      class="rings"
      width="160"
      height="160"
      viewBox="-20 -40 160 160"
      aria-hidden="true"
      fill="none"
    >
      <ellipse
        class="ring ring-outer"
        cx="60"
        cy="40"
        rx="56"
        ry="36"
        stroke="var(--color-sage)"
        stroke-width="1.5"
        stroke-opacity="0.4"
      />
      <ellipse
        class="ring ring-inner"
        cx="60"
        cy="40"
        rx="36"
        ry="22"
        stroke="var(--color-sage)"
        stroke-width="1.5"
        stroke-opacity="0.4"
      />
    </svg>

    <!-- Central symbol -->
    <span class="symbol" aria-hidden="true">✦</span>
  </div>

  <p class="status-text">{statusText}</p>

  <div class="tracker-wrap">
    <PassTracker {currentPass} {completedPasses} />
  </div>
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

  .orbital-wrap {
    position: relative;
    width: 160px;
    height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rings {
    position: absolute;
    inset: 0;
    overflow: visible;
  }

  .ring-outer {
    transform-box: fill-box;
    transform-origin: center;
    animation: orbitSpin 8s linear infinite;
  }

  .ring-inner {
    transform-box: fill-box;
    transform-origin: center;
    animation: orbitSpin 12s linear reverse infinite;
  }

  .symbol {
    position: relative;
    z-index: 1;
    font-family: var(--font-display);
    font-size: 24px;
    color: var(--color-sage);
    animation: symbolBreathe 3s ease-in-out infinite;
    line-height: 1;
  }

  .status-text {
    margin-top: 32px;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    text-align: center;
  }

  .tracker-wrap {
    margin-top: 24px;
  }

  @media (prefers-reduced-motion: reduce) {
    .ring-outer,
    .ring-inner,
    .symbol {
      animation: none;
    }
  }
</style>
