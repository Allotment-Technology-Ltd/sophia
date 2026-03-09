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
    { value: '', label: 'None', description: 'General perspective' },
    { value: 'utilitarian', label: 'Utilitarian', description: 'Outcomes and aggregate welfare' },
    { value: 'deontological', label: 'Deontological', description: 'Duties, rights, and constraints' },
    { value: 'virtue_ethics', label: 'Virtue', description: 'Character and flourishing' },
    { value: 'rawlsian', label: 'Rawlsian', description: 'Fairness and justice as fairness' },
    { value: 'care_ethics', label: 'Care ethics', description: 'Relationships and dependency' },
    { value: 'physicalist', label: 'Physicalist', description: 'Mind as fully physical and brain-based' },
    { value: 'dualist', label: 'Dualist', description: 'Mental and physical as fundamentally distinct' },
    { value: 'functionalist', label: 'Functionalist', description: 'Mental states by causal/functional roles' },
    { value: 'enactivist', label: 'Enactivist', description: 'Mind as embodied, embedded activity' },
    { value: 'phenomenological', label: 'Phenomenological', description: 'First-person structure of lived experience' }
  ];

  const allowedByDomain: Record<DomainSelection, string[]> = {
    auto: [
      '',
      'utilitarian',
      'deontological',
      'virtue_ethics',
      'rawlsian',
      'care_ethics',
      'physicalist',
      'dualist',
      'functionalist',
      'enactivist',
      'phenomenological'
    ],
    ethics: ['', 'utilitarian', 'deontological', 'virtue_ethics', 'rawlsian', 'care_ethics'],
    philosophy_of_mind: ['', 'physicalist', 'dualist', 'functionalist', 'enactivist', 'phenomenological']
  };

  const isDomainAuto = $derived(domain === 'auto');
  const availableOptions = $derived(
    options.filter((option) => allowedByDomain[domain].includes(option.value))
  );
  const activeOption = $derived(availableOptions.find((option) => option.value === value) ?? availableOptions[0]);
  const domainHint = $derived(
    isDomainAuto
      ? 'Lens is disabled while domain is Auto.'
      : domain === 'philosophy_of_mind'
      ? 'Showing Philosophy of Mind lenses.'
      : activeOption.description
  );
</script>

<div class="selector-row" aria-label="Reasoning lens selector">
  <label for="lens-select">Lens</label>
  <select id="lens-select" bind:value disabled={disabled || isDomainAuto}>
    {#each availableOptions as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="hint">{domainHint}</span>
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
