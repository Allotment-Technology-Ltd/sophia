<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { StoaProgressState } from '$lib/types/stoa';

  interface Props {
    progress: StoaProgressState;
  }

  const dispatch = createEventDispatcher<{ openJournal: void }>();

  let { progress }: Props = $props();

  const levelTitle = $derived(progress.levelTitle ?? `Level ${Math.max(1, progress.level)}`);
  const levelProgress = $derived(Math.max(0, Math.min(1, progress.levelProgress ?? 0)));
  const trendDirection = $derived(progress.reasoningTrend ?? 'steady');
  const trendGlyph = $derived(
    trendDirection === 'improved' ? '↑' : trendDirection === 'inconsistent' ? '↕' : '→'
  );
  const trendLabel = $derived(
    trendDirection === 'improved'
      ? 'improved'
      : trendDirection === 'inconsistent'
        ? 'been inconsistent'
        : 'held steady'
  );

  function openJournal(): void {
    dispatch('openJournal');
  }
</script>

<button
  type="button"
  class="progress-hud"
  onclick={openJournal}
  aria-label="Open quest journal"
  title="Open quest journal (J)"
>
  <p class="xp">
    <span>{progress.xp} XP</span>
    <span
      class="trend"
      aria-label={`Your reasoning has ${trendLabel} recently`}
      title={`Your reasoning has ${trendLabel} recently`}
      >{trendGlyph}</span
    >
  </p>
  <p class="title">{levelTitle}</p>
  <div class="bar-track" aria-hidden="true">
    <span class="bar-fill" style={`width:${Math.max(0.04, levelProgress) * 100}%`}></span>
  </div>
</button>

<style>
  .progress-hud {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 24;
    width: 212px;
    border-radius: 10px;
    border: 1px solid rgba(193, 160, 114, 0.38);
    background: rgba(26, 25, 23, 0.72);
    backdrop-filter: blur(6px);
    padding: 12px;
    display: grid;
    gap: 6px;
    text-align: left;
    cursor: pointer;
  }

  .xp,
  .title {
    margin: 0;
  }

  .xp {
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(233, 216, 186, 0.88);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .trend {
    font-size: 11px;
    line-height: 1;
    color: rgba(188, 208, 186, 0.88);
  }

  .title {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 20px;
    line-height: 1.2;
    color: rgba(247, 238, 223, 0.94);
  }

  .bar-track {
    height: 4px;
    border-radius: 999px;
    background: rgba(113, 94, 69, 0.44);
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(190, 143, 77, 0.95), rgba(228, 194, 147, 0.95));
    transition: width 300ms ease;
  }

  .progress-hud:focus-visible {
    outline: 1px solid rgba(236, 205, 161, 0.9);
    outline-offset: 2px;
  }

  @media (max-width: 900px) {
    .progress-hud {
      right: 16px;
      bottom: 16px;
      width: 188px;
      padding: 12px;
    }
  }
</style>
