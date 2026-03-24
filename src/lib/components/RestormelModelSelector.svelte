<script lang="ts">
  /**
   * We do not import `@restormel/keys-svelte` ModelSelector here: that package ships a prebundled
   * Svelte runtime in `dist/index.js`, which mounts components outside the app effect tree and
   * throws `effect_orphan` in production. The headless `keys` instance stays on the public API.
   */
  import { resolveProviderId, type KeysInstance, type ProviderDefinition } from '@restormel/keys';

  interface Props {
    value?: string;
    keys: KeysInstance;
    providers: ProviderDefinition[];
    disabled?: boolean;
    layout?: 'inline' | 'stacked';
    loading?: boolean;
    errorMessage?: string;
    emptyMessage?: string;
    onRetry?: (() => void) | undefined;
    onSelect?: ((providerId: string, modelId: string) => void) | undefined;
  }

  let {
    value = $bindable<string>('auto'),
    keys,
    providers,
    disabled = false,
    layout = 'inline',
    loading = false,
    errorMessage = '',
    emptyMessage = '',
    onRetry,
    onSelect
  }: Props = $props();

  const explicitSelection = $derived.by(() => {
    if (!value || value === 'auto') return null;
    const splitIdx = value.indexOf('::');
    if (splitIdx <= 0) return null;
    const providerId = value.slice(0, splitIdx);
    const modelId = value.slice(splitIdx + 2);
    if (!modelId) return null;
    const provider = resolveProviderId(providerId, providers);
    return {
      providerName: provider?.name ?? providerId,
      modelId
    };
  });
  const hasProviders = $derived(providers.length > 0);
  const showFallbackWarning = $derived(Boolean(errorMessage));
  const canRenderSelector = $derived(hasProviders && !loading);

  function handleAutoSelect(): void {
    value = 'auto';
  }

  function handleSelect(modelId: string, providerId: string): void {
    value = `${providerId}::${modelId}`;
    onSelect?.(providerId, modelId);
  }
</script>

<div class="restormel-model-shell" class:stacked={layout === 'stacked'} aria-label="Model selector">
  <div class="restormel-model-header">
    <div class="restormel-model-header-main">
      <span class="restormel-model-label">Choose your model</span>
      <button
        type="button"
        class="restormel-auto-btn"
        class:active={value === 'auto'}
        onclick={handleAutoSelect}
        disabled={disabled}
        aria-pressed={value === 'auto'}
      >
        Use automatic routing
      </button>
    </div>
  </div>

  <div class="restormel-model-summary" role="status" aria-live="polite">
    {#if explicitSelection}
      Selected: {explicitSelection.providerName} · {explicitSelection.modelId}
    {:else}
      Selected: Automatic route selection
    {/if}
  </div>

  {#if showFallbackWarning}
    <div class="restormel-model-state warning" role="status" aria-live="polite">
      <span>{errorMessage}</span>
      {#if onRetry}
        <button type="button" class="restormel-retry-btn" onclick={onRetry}>Retry</button>
      {/if}
    </div>
  {/if}

  <div class="restormel-theme-shell" class:is-disabled={disabled}>
    {#if canRenderSelector}
      <div class="restormel-native-picker" role="listbox" aria-label="Explicit models">
        {#each providers as provider (provider.id)}
          <div class="restormel-provider-block" role="group" aria-label={provider.name}>
            <span class="restormel-provider-title">{provider.name}</span>
            <div class="restormel-model-pills">
              {#each provider.models as modelId (modelId)}
                <button
                  type="button"
                  class="restormel-model-pill"
                  class:active={value === `${provider.id}::${modelId}`}
                  disabled={disabled}
                  onclick={() => handleSelect(modelId, provider.id)}
                >
                  {modelId}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="restormel-placeholder" role="status" aria-live="polite">
        <div class="restormel-placeholder-chip"></div>
        <div class="restormel-placeholder-line wide"></div>
        <div class="restormel-placeholder-line"></div>
        <div class="restormel-model-state">
          {#if loading}
            Loading models…
          {:else}
            {emptyMessage || 'No explicit models are currently available for this key source.'}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if emptyMessage && canRenderSelector}
    <div class="restormel-model-state" role="status">{emptyMessage}</div>
  {/if}
</div>

<style>
  .restormel-model-shell {
    width: 100%;
    display: grid;
    gap: var(--space-2);
    font-family: var(--font-ui);
  }

  .restormel-model-shell.stacked {
    gap: 6px;
  }

  .restormel-model-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
  }

  .restormel-model-header-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .restormel-model-label {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .restormel-auto-btn,
  .restormel-retry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .restormel-auto-btn.active {
    background: color-mix(in oklab, var(--color-sage) 22%, transparent);
    border-color: color-mix(in oklab, var(--color-sage) 55%, var(--color-border));
  }

  .restormel-auto-btn:disabled,
  .restormel-retry-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .restormel-model-summary {
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .restormel-model-state {
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .restormel-model-state.warning {
    display: grid;
    gap: 10px;
    color: color-mix(in oklab, var(--color-danger, #d35b5b) 88%, white 12%);
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--color-danger, #d35b5b) 32%, var(--color-border));
    border-radius: 10px;
    background: color-mix(in oklab, var(--color-danger, #d35b5b) 8%, transparent);
  }

  .restormel-theme-shell {
    --rk-bg: color-mix(in oklab, var(--color-surface) 92%, transparent);
    --rk-text: var(--color-text);
    --rk-accent: var(--color-sage);
    --rk-border: color-mix(in oklab, var(--color-border) 80%, transparent);
    --rk-error: var(--color-danger, #d35b5b);
    --rk-success: #5aa36f;
    border: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.7rem;
    background: color-mix(in oklab, var(--color-surface) 90%, transparent);
    min-height: 118px;
  }

  .restormel-theme-shell.is-disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .restormel-placeholder {
    display: grid;
    gap: 0.6rem;
    align-content: start;
  }

  .restormel-placeholder-chip,
  .restormel-placeholder-line {
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-border) 55%, transparent);
    opacity: 0.7;
  }

  .restormel-placeholder-chip {
    width: 6rem;
    height: 0.85rem;
  }

  .restormel-placeholder-line {
    width: 60%;
    height: 0.85rem;
  }

  .restormel-placeholder-line.wide {
    width: 88%;
  }

  .restormel-native-picker {
    display: grid;
    gap: 0.65rem;
    align-content: start;
  }

  .restormel-provider-block {
    display: grid;
    gap: 0.35rem;
  }

  .restormel-provider-title {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .restormel-model-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .restormel-model-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.55rem;
    border: 1px solid color-mix(in oklab, var(--rk-border) 90%, transparent);
    border-radius: 999px;
    background: color-mix(in oklab, var(--rk-bg) 70%, transparent);
    color: var(--rk-text);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .restormel-model-pill:hover:not(:disabled) {
    border-color: color-mix(in oklab, var(--rk-accent) 45%, var(--rk-border));
    background: color-mix(in oklab, var(--rk-accent) 12%, var(--rk-bg));
  }

  .restormel-model-pill:focus-visible {
    outline: 2px solid color-mix(in oklab, var(--rk-accent) 65%, transparent);
    outline-offset: 2px;
  }

  .restormel-model-pill.active {
    border-color: color-mix(in oklab, var(--rk-accent) 55%, var(--rk-border));
    background: color-mix(in oklab, var(--rk-accent) 20%, transparent);
  }

  .restormel-model-pill:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .restormel-auto-btn {
      width: 100%;
      justify-content: center;
    }

    .restormel-retry-btn {
      width: 100%;
    }
  }
</style>
