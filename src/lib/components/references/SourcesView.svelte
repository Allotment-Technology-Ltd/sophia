<script lang="ts">
  import { referencesStore } from '$lib/stores/references.svelte';
  import type { PassType } from '$lib/types/passes';

  function getPassLabel(pass: PassType): string {
    switch (pass) {
      case 'analysis': return 'Analysis';
      case 'critique': return 'Critique';
      case 'synthesis': return 'Synthesis';
      case 'verification': return 'Verification';
    }
  }

  function getPassBadgeClass(pass: PassType): string {
    switch (pass) {
      case 'analysis': return 'pass-badge-analysis';
      case 'critique': return 'pass-badge-critique';
      case 'synthesis': return 'pass-badge-synthesis';
      case 'verification': return 'pass-badge-verification';
    }
  }

  function getDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  function getFaviconUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    } catch {
      return '';
    }
  }

  // Group sources by pass
  const sourcesByPass = $derived.by(() => {
    const grouped = new Map<PassType, typeof referencesStore.groundingSources>();
    
    for (const source of referencesStore.groundingSources) {
      const existing = grouped.get(source.pass) || [];
      grouped.set(source.pass, [...existing, source]);
    }
    
    return grouped;
  });

  const hasAnySources = $derived(referencesStore.groundingSources.length > 0);
  const passOrder: PassType[] = ['analysis', 'critique', 'synthesis', 'verification'];
</script>

<div class="sources-view">
  {#if !hasAnySources}
    <div class="empty-state">
      <p class="empty-text">
        No web sources yet. Google Search grounding will populate this during streaming.
      </p>
    </div>
  {:else}
    {#each passOrder as pass}
      {#if sourcesByPass.has(pass)}
        {@const sources = sourcesByPass.get(pass)}
        <div class="pass-section">
          <div class="pass-header">
            <span class="pass-badge {getPassBadgeClass(pass)}">{getPassLabel(pass)}</span>
            <span class="source-count">{sources?.length || 0} {sources?.length === 1 ? 'source' : 'sources'}</span>
          </div>
          
          <div class="source-list">
            {#each sources || [] as source, idx (source.url + idx)}
              <a 
                href={source.url} 
                target="_blank" 
                rel="noopener noreferrer"
                class="source-card"
              >
                <div class="source-favicon">
                  <img src={getFaviconUrl(source.url)} alt="" width="16" height="16" />
                </div>
                <div class="source-content">
                  <div class="source-title">
                    {source.title || 'Untitled'}
                  </div>
                  <div class="source-url">
                    {getDomain(source.url)}
                  </div>
                </div>
                <div class="source-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </div>
              </a>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .sources-view {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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
    max-width: 280px;
  }

  .pass-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pass-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }

  .pass-badge {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .pass-badge-analysis {
    background: hsl(210, 80%, 95%);
    color: hsl(210, 80%, 40%);
  }

  .pass-badge-critique {
    background: hsl(350, 80%, 95%);
    color: hsl(350, 80%, 40%);
  }

  .pass-badge-synthesis {
    background: hsl(160, 60%, 95%);
    color: hsl(160, 60%, 35%);
  }

  .pass-badge-verification {
    background: hsl(280, 60%, 95%);
    color: hsl(280, 60%, 40%);
  }

  .source-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .source-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .source-card {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
  }

  .source-card:hover {
    background: var(--color-surface-raised);
    border-color: var(--color-primary);
    transform: translateY(-1px);
  }

  .source-favicon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .source-favicon img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .source-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .source-title {
    font-family: var(--font-ui);
    font-size: var(--text-body);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .source-url {
    font-family: var(--font-mono);
    font-size: var(--text-meta);
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--color-dim);
    transition: color 0.15s ease;
  }

  .source-card:hover .source-icon {
    color: var(--color-primary);
  }
</style>
