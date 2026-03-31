<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fetchWithAuth } from '$lib/stoa/fetchWithAuth';
  import type { ArrivalReason, StartingPath, StoaProfile } from '$lib/types/stoa';
  import StoaReasonScreen from './StoaReasonScreen.svelte';
  import StoaStruggleScreen from './StoaStruggleScreen.svelte';

  const dispatch = createEventDispatcher<{ setupComplete: { profile: StoaProfile } }>();

  let step = $state<'reason' | 'struggle' | 'complete'>('reason');
  let transitionOpacity = $state(0);
  let arrivalReason = $state<ArrivalReason | null>(null);
  let startingPath = $state<StartingPath>('colonnade');
  let errorText = $state<string | null>(null);
  let authRequired = $state(false);
  let struggleScreenVersion = $state(0);

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
    authRequired = false;
    errorText = null;
    await crossfade('struggle');
  }

  async function handleStruggleComplete(event: CustomEvent<{ struggle: string | null }>) {
    if (!arrivalReason) return;
    errorText = null;
    authRequired = false;
    try {
      const response = await fetchWithAuth('/api/stoa/profile', {
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
          authRequired = true;
          errorText = 'Sign in is required to continue your STOA session.';
          struggleScreenVersion += 1;
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
      struggleScreenVersion += 1;
    }
  }
</script>

<div class="setup-layer">
  {#if step === 'reason'}
    <StoaReasonScreen on:complete={handleReasonComplete} />
  {:else if step === 'struggle'}
    {#key struggleScreenVersion}
      <StoaStruggleScreen {startingPath} on:complete={handleStruggleComplete} />
    {/key}
  {/if}

  <div class="transition" style:opacity={transitionOpacity} aria-hidden="true"></div>

  {#if errorText}
    <div class="error">{errorText}</div>
  {/if}
  {#if authRequired}
    <a class="auth-cta" href="/early-access?next=/stoa">Request early access</a>
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
    bottom: 84px;
    left: 50%;
    transform: translateX(-50%);
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 20px;
    z-index: 30;
    text-align: center;
    max-width: min(90vw, 720px);
    padding: 0 16px;
  }

  .auth-cta {
    position: absolute;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 31;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 12px 20px;
    border-radius: 999px;
    border: 1px solid rgba(232, 220, 200, 0.5);
    background: rgba(122, 92, 54, 0.32);
    color: #e8dcc8;
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition:
      background 180ms ease,
      border-color 180ms ease,
      transform 180ms ease;
  }

  .auth-cta:hover {
    background: rgba(122, 92, 54, 0.52);
    border-color: rgba(232, 220, 200, 0.75);
    transform: translate(-50%, -1px);
  }

  .auth-cta:focus-visible {
    outline: 2px solid rgba(232, 220, 200, 0.92);
    outline-offset: 4px;
  }
</style>
