<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ArrivalReason, StartingPath, StoaProfile } from '$lib/types/stoa';
  import StoaReasonScreen from './StoaReasonScreen.svelte';
  import StoaStruggleScreen from './StoaStruggleScreen.svelte';

  const dispatch = createEventDispatcher<{ setupComplete: { profile: StoaProfile } }>();

  let step = $state<'reason' | 'struggle' | 'complete'>('reason');
  let transitionOpacity = $state(0);
  let arrivalReason = $state<ArrivalReason | null>(null);
  let startingPath = $state<StartingPath>('colonnade');
  let errorText = $state<string | null>(null);

  async function crossfade(toStep: 'reason' | 'struggle' | 'complete'): Promise<void> {
    transitionOpacity = 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    step = toStep;
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    transitionOpacity = 0;
  }

  async function handleReasonComplete(event: CustomEvent<{ reason: ArrivalReason; startingPath: StartingPath }>) {
    arrivalReason = event.detail.reason;
    startingPath = event.detail.startingPath;
    await crossfade('struggle');
  }

  async function handleStruggleComplete(event: CustomEvent<{ struggle: string | null }>) {
    if (!arrivalReason) return;
    errorText = null;
    try {
      const response = await fetch('/api/stoa/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrivalReason,
          startingPath,
          openingStruggle: event.detail.struggle
        })
      });
      if (!response.ok) {
        if (response.status === 401) {
          errorText = 'Sign in to save your Stoa profile and continue.';
          return;
        }
        throw new Error('Profile setup request failed');
      }
      const payload = (await response.json()) as { profile?: StoaProfile };
      if (!payload.profile) {
        throw new Error('Profile setup did not return a profile');
      }
      await crossfade('complete');
      dispatch('setupComplete', { profile: payload.profile });
    } catch {
      errorText = 'Unable to complete setup. Please try again.';
    }
  }
</script>

<div class="setup-layer">
  {#if step === 'reason'}
    <StoaReasonScreen on:complete={handleReasonComplete} />
  {:else if step === 'struggle'}
    <StoaStruggleScreen {startingPath} on:complete={handleStruggleComplete} />
  {/if}

  <div class="transition" style:opacity={transitionOpacity} aria-hidden="true"></div>

  {#if errorText}
    <div class="error">{errorText}</div>
  {/if}
</div>

<style>
  .setup-layer {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: #000;
  }

  .transition {
    position: absolute;
    inset: 0;
    background: #000;
    pointer-events: none;
    transition: opacity 400ms ease;
    z-index: 25;
  }

  .error {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 20px;
    z-index: 30;
  }
</style>
