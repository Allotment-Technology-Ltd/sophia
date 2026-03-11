<script lang="ts">
  interface LensOption {
    value: string;
    label: string;
    description: string;
  }

  type DomainSelection = 'auto' | 'ethics' | 'philosophy_of_mind';

  interface Props {
    value?: string;
    disabled?: boolean;
    domain?: DomainSelection;
  }

  let { value = $bindable(''), disabled = false, domain = 'auto' }: Props = $props();

  const options: LensOption[] = [
    { value: '', label: 'None', description: 'No specific style selected.' },
    {
      value: 'balanced_dialogue',
      label: 'Balanced Dialogue',
      description: 'Clear, even-handed reasoning guided by empathy and logic.'
    },
    {
      value: 'socratic',
      label: 'Socratic',
      description: 'Exploratory questioning — answers built through dialogue.'
    },
    {
      value: 'realist_pragmatist',
      label: 'Realist / Pragmatist',
      description: 'Emphasis on grounded consequences and moral clarity.'
    },
    {
      value: 'continental',
      label: 'Continental',
      description: 'Rich, interpretive language, teasing out hidden meanings.'
    }
  ];

  const allowedByDomain: Record<DomainSelection, string[]> = {
    auto: ['', 'balanced_dialogue', 'socratic', 'realist_pragmatist', 'continental'],
    ethics: ['', 'balanced_dialogue', 'socratic', 'realist_pragmatist', 'continental'],
    philosophy_of_mind: ['', 'balanced_dialogue', 'socratic', 'realist_pragmatist', 'continental']
  };

  const isDomainAuto = $derived(domain === 'auto');
  const availableOptions = $derived(
    options.filter((option) => allowedByDomain[domain].includes(option.value))
  );
  const activeOption = $derived(availableOptions.find((option) => option.value === value) ?? availableOptions[0]);
  const domainHint = $derived(
    isDomainAuto
      ? 'Perspective is disabled while reasoning focus is Auto.'
      : activeOption.description
  );
</script>

<div class="selector-row" aria-label="Reasoning lens selector">
  <label for="lens-select">Perspective (optional)</label>
  <select id="lens-select" bind:value disabled={disabled || isDomainAuto}>
    {#each availableOptions as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="hint">
    {#if !isDomainAuto}
      Each lens changes SOPHIA's reasoning voice — not her intelligence, but her style of engagement.
    {:else}
      {domainHint}
    {/if}
  </span>
</div>

<style>
  .selector-row {
    width: 100%;
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
