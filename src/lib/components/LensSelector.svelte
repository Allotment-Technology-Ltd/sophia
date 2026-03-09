<script lang="ts">
  interface LensOption {
    value: string;
    label: string;
    description: string;
  }

  interface Props {
    value?: string;
    disabled?: boolean;
  }

  let { value = $bindable(''), disabled = false }: Props = $props();

  const options: LensOption[] = [
    { value: '', label: 'None', description: 'General perspective' },
    { value: 'utilitarian', label: 'Utilitarian', description: 'Outcomes and aggregate welfare' },
    { value: 'deontological', label: 'Deontological', description: 'Duties, rights, and constraints' },
    { value: 'virtue_ethics', label: 'Virtue', description: 'Character and flourishing' },
    { value: 'rawlsian', label: 'Rawlsian', description: 'Fairness and justice as fairness' },
    { value: 'care_ethics', label: 'Care ethics', description: 'Relationships and dependency' }
  ];

  const activeOption = $derived(options.find((option) => option.value === value) ?? options[0]);
</script>

<div class="selector-row" aria-label="Reasoning lens selector">
  <label for="lens-select">Lens</label>
  <select id="lens-select" bind:value {disabled}>
    {#each options as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="hint">{activeOption.description}</span>
</div>

<style>
  .selector-row {
    width: min(700px, 100%);
    display: grid;
    grid-template-columns: auto minmax(160px, 220px) 1fr;
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
    .selector-row {
      grid-template-columns: auto 1fr;
    }

    .hint {
      grid-column: 1 / -1;
    }
  }
</style>
