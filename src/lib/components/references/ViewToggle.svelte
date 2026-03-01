<script lang="ts">
  export type ViewMode = 'claims' | 'sources';

  interface Props {
    active: ViewMode;
    onToggle: (mode: ViewMode) => void;
  }

  let { active, onToggle }: Props = $props();
</script>

<div class="view-toggle" role="tablist" aria-label="View mode">
  <button
    class="toggle-btn"
    class:is-active={active === 'claims'}
    role="tab"
    aria-selected={active === 'claims'}
    onclick={() => onToggle('claims')}
  >
    Claims
  </button>
  <button
    class="toggle-btn"
    class:is-active={active === 'sources'}
    role="tab"
    aria-selected={active === 'sources'}
    onclick={() => onToggle('sources')}
  >
    Sources
  </button>
</div>

<style>
  .view-toggle {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .toggle-btn {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-dim);
    transition: color var(--transition-base), border-color var(--transition-base);
  }

  .toggle-btn:hover {
    color: var(--color-muted);
  }

  .toggle-btn.is-active {
    color: var(--color-text);
    border-bottom-color: var(--color-sage);
  }
</style>
