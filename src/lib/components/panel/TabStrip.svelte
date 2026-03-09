<script lang="ts">
  export type TabId = 'references' | 'map' | 'history' | 'settings';

  export interface Tab {
    id: TabId;
    label: string;
    showLiveDot?: boolean; // controlled externally; hidden initially
  }

  interface Props {
    tabs: Tab[];
    activeTab: TabId;
    onTabChange: (id: TabId) => void;
  }

  let { tabs, activeTab, onTabChange }: Props = $props();

  // Compute indicator position & width
  let indicatorStyle = $derived(() => {
    const idx = tabs.findIndex(t => t.id === activeTab);
    if (idx === -1) return '';
    const pct = (idx / tabs.length) * 100;
    return `left: ${pct}%; width: ${100 / tabs.length}%`;
  });
</script>

<div class="tab-strip" role="tablist" aria-label="Side panel tabs">
  {#each tabs as tab, i (tab.id)}
    <button
      class="tab-btn"
      class:is-active={activeTab === tab.id}
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls="panel-{tab.id}"
      id="tab-{tab.id}"
      onclick={() => onTabChange(tab.id)}
    >
      <span class="tab-label">{tab.label}</span>
      {#if tab.showLiveDot}
        <span class="live-dot" aria-label="Live" title="Active"></span>
      {/if}
    </button>
  {/each}

  <!-- Animated indicator line -->
  <div class="tab-indicator" style={indicatorStyle()} aria-hidden="true"></div>
</div>

<style>
  .tab-strip {
    position: relative;
    display: flex;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--text-label);
    font-weight: 400;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-dim);
    transition: color var(--transition-base);
    position: relative;
  }

  .tab-btn:hover {
    color: var(--color-muted);
  }

  .tab-btn.is-active {
    color: var(--color-text);
  }

  .tab-label {
    position: relative;
    z-index: 1;
  }

  /* Animated indicator */
  .tab-indicator {
    position: absolute;
    bottom: -1px;
    height: 2px;
    background: var(--color-sage);
    transition: left var(--transition-base), width var(--transition-base);
    pointer-events: none;
  }

  /* Live dot */
  .live-dot {
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-sage);
    animation: symbol-breathe 2s ease-in-out infinite;
    flex-shrink: 0;
  }
</style>
