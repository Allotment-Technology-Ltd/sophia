<script lang="ts">
  export interface ModelOption {
    value: string;
    label: string;
    description: string;
  }

  interface Props {
    value?: string;
    options?: ModelOption[];
    disabled?: boolean;
  }

  let {
    value = $bindable<string>('auto'),
    options = [],
    disabled = false
  }: Props = $props();

  const selected = $derived(options.find((option) => option.value === value));
</script>

<div class="model-row" aria-label="Model selector">
  <label for="model-select">Model</label>
  <select id="model-select" bind:value {disabled}>
    {#each options as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="hint">{selected?.description ?? 'Select a model'}</span>
</div>

<style>
  .model-row {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(220px, 360px) 1fr;
    gap: var(--space-2);
    align-items: center;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-transform: uppercase;
  }

  select {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .hint {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  @media (max-width: 720px) {
    .model-row {
      grid-template-columns: auto 1fr;
    }

    .hint {
      grid-column: 1 / -1;
    }
  }
</style>
