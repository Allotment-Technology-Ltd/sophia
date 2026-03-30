<script lang="ts">
  import type { StanceType } from '$lib/types/stoa';

  interface Props {
    stance: StanceType;
  }

  let { stance }: Props = $props();

  const STANCE_ORDER: StanceType[] = ['hold', 'challenge', 'guide', 'teach', 'sit_with'];
</script>

<aside class="stance-indicator" aria-label="Current dialogue stance">
  <div class="dots" role="presentation">
    {#each STANCE_ORDER as key}
      <span class="dot {key} {stance === key ? 'active' : ''}" aria-hidden="true"></span>
    {/each}
  </div>
  <p class="label">{stance.replace('_', ' ')}</p>
</aside>

<style>
  .stance-indicator {
    position: fixed;
    left: 24px;
    bottom: 24px;
    display: grid;
    gap: 8px;
    z-index: 20;
  }

  .dots {
    display: flex;
    gap: 8px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    opacity: 0.2;
    transition: opacity 400ms ease;
  }

  .dot.active {
    opacity: 1;
  }

  .dot.hold {
    background: #7a9f83;
  }

  .dot.challenge {
    background: #c58b52;
  }

  .dot.guide {
    background: #6f9ec9;
  }

  .dot.teach {
    background: #5b9a93;
  }

  .dot.sit_with {
    background: #d2cec6;
  }

  .label {
    margin: 0;
    color: rgba(224, 216, 200, 0.72);
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
