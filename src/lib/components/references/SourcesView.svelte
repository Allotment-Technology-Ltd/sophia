<script lang="ts">
  import { referencesStore } from '$lib/stores/references.svelte';
  import type { PassType } from '@restormel/contracts/passes';

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

  // Group web sources by pass
  const webSourcesByPass = $derived.by(() => {
    const grouped = new Map<PassType, typeof referencesStore.groundingSources>();
    for (const source of referencesStore.groundingSources) {
      const existing = grouped.get(source.pass) || [];
      grouped.set(source.pass, [...existing, source]);
    }
    return grouped;
  });

  const hasKbSources = $derived(referencesStore.sources.length > 0);
  const hasWebSources = $derived(referencesStore.groundingSources.length > 0);
  const hasClaimSources = $derived(referencesStore.claimSources.length > 0);
  const hasAnySources = $derived(hasKbSources || hasWebSources || hasClaimSources);

  const passOrder: PassType[] = ['analysis', 'critique', 'synthesis', 'verification'];
</script>

<div class="sources-view">
  {#if !hasAnySources}
    <div class="empty-state">
      <p class="empty-text">
        No sources yet. Sources from the knowledge base and web search will appear here.
      </p>
    </div>
  {:else}

    <!-- Cited Sources (derived from LLM claims) -->
    {#if hasClaimSources}
      <div class="section">
        <div class="section-header">
          <span class="section-label">Cited Works</span>
          <span class="section-count">{referencesStore.claimSources.length} {referencesStore.claimSources.length === 1 ? 'source' : 'sources'}</span>
        </div>
        <div class="source-list">
          {#each referencesStore.claimSources as cs (cs.source)}
            <div class="cited-card">
              {#if cs.sourceUrl}
                <a href={cs.sourceUrl} target="_blank" rel="noopener noreferrer" class="cited-link">
                  <div class="cited-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                  </div>
                  <div class="cited-content">
                    <div class="cited-title">{cs.source}</div>
                    {#if cs.tradition}
                      <div class="cited-tradition">{cs.tradition}</div>
                    {/if}
                  </div>
                  <div class="cited-count" title="{cs.claimCount} claim{cs.claimCount !== 1 ? 's' : ''} from this source">
                    {cs.claimCount}
                  </div>
                </a>
              {:else}
                <div class="cited-icon" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                </div>
                <div class="cited-content">
                  <div class="cited-title">{cs.source}</div>
                  {#if cs.tradition}
                    <div class="cited-tradition">{cs.tradition}</div>
                  {/if}
                </div>
                <div class="cited-count" title="{cs.claimCount} claim{cs.claimCount !== 1 ? 's' : ''} from this source">
                  {cs.claimCount}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Knowledge Base Sources -->
    {#if hasKbSources}
      <div class="section">
        <div class="section-header">
          <span class="section-label">Knowledge Base</span>
          <span class="section-count">{referencesStore.sources.length} {referencesStore.sources.length === 1 ? 'source' : 'sources'}</span>
        </div>
        <div class="source-list">
          {#each referencesStore.sources as source (source.id)}
            <div class="kb-card">
              <div class="kb-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
              <div class="kb-content">
                <div class="kb-title">{source.title}</div>
                {#if source.author.length > 0}
                  <div class="kb-author">{source.author.join(', ')}</div>
                {/if}
              </div>
              <div class="kb-claim-count" title="{source.claimCount} claim{source.claimCount !== 1 ? 's' : ''} drawn from this source">
                {source.claimCount}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Web Sources -->
    {#if hasWebSources}
      <div class="section">
        <div class="section-header">
          <span class="section-label">Web Sources</span>
          <span class="section-count">{referencesStore.groundingSources.length} {referencesStore.groundingSources.length === 1 ? 'source' : 'sources'}</span>
        </div>

        {#each passOrder as pass}
          {#if webSourcesByPass.has(pass)}
            {@const sources = webSourcesByPass.get(pass)}
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
      </div>
    {/if}

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

  /* Section containers */
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }

  .section-label {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-muted);
  }

  .section-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  /* Cited works (from LLM claims) */
  .cited-card {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
  }

  a.cited-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: inherit;
    width: 100%;
    transition: background var(--transition-fast);
  }

  a.cited-link:hover {
    opacity: 0.85;
  }

  .cited-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-sage);
    flex-shrink: 0;
  }

  .cited-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .cited-title {
    font-family: var(--font-display);
    font-size: 0.85rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .cited-tradition {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cited-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-sage);
    flex-shrink: 0;
    background: var(--color-sage-bg);
    border: 1px solid var(--color-sage-border);
    border-radius: 2px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  /* Knowledge base cards */
  .source-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .kb-card {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
  }

  .kb-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-amber);
    flex-shrink: 0;
  }

  .kb-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .kb-title {
    font-family: var(--font-display);
    font-size: 0.85rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .kb-author {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-claim-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-sage);
    flex-shrink: 0;
    background: var(--color-sage-bg);
    border: 1px solid var(--color-sage-border);
    border-radius: 2px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  /* Web source pass grouping */
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
    border-radius: 2px;
  }

  .pass-badge-analysis {
    background: var(--color-sage-bg);
    color: var(--color-sage);
  }

  .pass-badge-critique {
    background: var(--color-copper-bg);
    color: var(--color-copper);
  }

  .pass-badge-synthesis {
    background: var(--color-blue-bg);
    color: var(--color-blue);
  }

  .pass-badge-verification {
    background: var(--color-amber-bg);
    color: var(--color-amber);
  }

  .source-count {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  /* Individual web source cards */
  .source-card {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    text-decoration: none;
    color: inherit;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .source-card:hover {
    background: var(--color-surface-raised);
    border-color: var(--color-dim);
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
    font-family: var(--font-display);
    font-size: 0.85rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .source-url {
    font-family: var(--font-ui);
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
    transition: color var(--transition-fast);
  }

  .source-card:hover .source-icon {
    color: var(--color-muted);
  }
</style>
