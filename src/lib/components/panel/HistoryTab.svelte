<script lang="ts">
  export interface HistoryEntry {
    id: string;
    question: string;
    timestamp: Date;
    passCount: number; // 1–3 passes completed
    modelProvider?: 'auto' | 'vertex' | 'anthropic';
    modelId?: string;
    depthMode?: 'quick' | 'standard' | 'deep';
  }

  interface Props {
    entries?: HistoryEntry[];
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  let { entries = [], onSelect, onDelete }: Props = $props();

  function formatAge(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
  }
</script>

<div class="history-tab">
  {#if entries.length === 0}
    <div class="empty-state">
      <p class="empty-text">Ready to think? Describe a decision that matters.</p>
    </div>
  {:else}
    <ul class="history-list" aria-label="Past analyses">
      {#each entries as entry (entry.id)}
        <li>
            <div class="history-row">
            <button
              class="history-item"
              onclick={() => onSelect?.(entry.id)}
            >
              <!-- Arc SVG: shows how many passes completed -->
              <svg
                class="arc-icon"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <!-- Background ring -->
                <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-border)" stroke-width="1.5"/>
                <!-- Filled arc by pass count (1=120°, 2=240°, 3=360°) -->
                {#if entry.passCount >= 1}
                  <path
                    d="M 12 3 A 9 9 0 0 1 {12 + 9 * Math.sin((entry.passCount / 3) * 2 * Math.PI)} {12 - 9 * Math.cos((entry.passCount / 3) * 2 * Math.PI)}"
                    fill="none"
                    stroke="var(--color-sage)"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                {/if}
              </svg>

              <div class="item-body">
                <span class="item-question">{entry.question}</span>
                <span class="item-meta">{formatAge(entry.timestamp)}</span>
                <span class="item-meta-row">
                  {#if entry.modelProvider}
                    <span class="model-chip">
                      {entry.modelProvider === 'anthropic' ? 'Claude' : entry.modelProvider === 'vertex' ? 'Gemini' : 'Auto'}
                      {#if entry.modelId}
                        <span class="model-id">{entry.modelId}</span>
                      {/if}
                    </span>
                  {/if}
                  {#if entry.depthMode}
                    <span class="depth-chip">{entry.depthMode}</span>
                  {/if}
                </span>
              </div>
            </button>

            {#if onDelete}
              <button
                class="delete-btn"
                aria-label="Delete {entry.question}"
                onclick={(e) => { e.stopPropagation(); onDelete?.(entry.id); }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history-tab {
    padding: var(--space-3) 0;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6) var(--space-4);
    min-height: 200px;
  }

  .empty-text {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-body);
    color: var(--color-dim);
    text-align: center;
    margin: 0;
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .history-row {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--color-border);
  }

  .history-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .history-item:hover {
    background: var(--color-surface-raised);
  }

  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-3);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-dim);
    flex-shrink: 0;
    transition: color var(--transition-fast);
  }

  .delete-btn:hover {
    color: var(--color-coral);
  }

  .arc-icon {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .item-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .item-question {
    font-family: var(--font-display);
    font-size: 0.9rem;
    color: var(--color-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .item-meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .model-chip,
  .depth-chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 2px 7px;
    font-family: var(--font-ui);
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: var(--color-surface-raised);
    gap: 6px;
  }

  .model-id {
    color: var(--color-dim);
    font-size: 0.54rem;
    text-transform: none;
    letter-spacing: 0;
  }
</style>
