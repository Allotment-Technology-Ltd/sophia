<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { ReasoningAssessment } from '$lib/types/stoa';

  interface Props {
    assessment: ReasoningAssessment | null;
  }

  let { assessment }: Props = $props();
  let visible = $state(false);
  let text = $state('');
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHideTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function titleCaseFramework(frameworkId: string): string {
    return frameworkId
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function buildAcknowledgement(next: ReasoningAssessment): string | null {
    if (next.qualityScore <= 0.6) return null;
    if (!next.improvementDetected) return null;
    if (next.dimensions.epistemicCalibration < 0.4) return null;

    if (next.dimensions.frameworkApplication >= 0.72 && next.frameworksApplied.length > 0) {
      return `You are applying ${titleCaseFramework(next.frameworksApplied[0])}, not just invoking it.`;
    }
    if (next.dimensions.logicalConsistency >= 0.72) {
      return 'Your reasoning held together well there.';
    }
    if (next.dimensions.emotionalHonesty >= 0.72) {
      return 'There is clarity in naming what you feel.';
    }
    return null;
  }

  $effect(() => {
    if (!assessment) {
      visible = false;
      text = '';
      clearHideTimer();
      return;
    }

    const nextText = buildAcknowledgement(assessment);
    if (!nextText) {
      visible = false;
      text = '';
      clearHideTimer();
      return;
    }

    text = nextText;
    visible = true;
    clearHideTimer();
    hideTimer = setTimeout(() => {
      visible = false;
    }, 5000);
  });

  onDestroy(() => {
    clearHideTimer();
  });
</script>

{#if visible && text}
  <p class="reasoning-ack" aria-live="polite" in:fade={{ duration: 240 }} out:fade={{ duration: 300 }}>
    {text}
  </p>
{/if}

<style>
  .reasoning-ack {
    position: absolute;
    left: 50%;
    bottom: 84px;
    transform: translateX(-50%);
    width: min(60vw, 860px);
    margin: 0;
    font-family: 'JetBrains Mono', var(--font-ui);
    font-size: 12px;
    line-height: 1.45;
    color: rgba(164, 187, 166, 0.88);
    text-align: left;
    z-index: 18;
    pointer-events: none;
  }

  @media (max-width: 1024px) {
    .reasoning-ack {
      width: min(92vw, 720px);
      bottom: 62px;
    }
  }
</style>
