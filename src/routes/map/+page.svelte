<script lang="ts">
  import { goto } from '$app/navigation';
  import MapTab from '$lib/components/panel/MapTab.svelte';

  function backToWorkspace(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('panelTab', 'map');
    void goto(url.toString(), { replaceState: false, noScroll: true, keepFocus: true, invalidateAll: false });
  }

  function openReferences(nodeId: string): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('panelTab', 'references');
    if (nodeId) {
      url.searchParams.set('mapNode', nodeId);
    }
    void goto(url.toString(), { replaceState: false, noScroll: false, keepFocus: true, invalidateAll: false });
  }
</script>

<section class="map-page" aria-label="Full page argument map">
  <header class="map-page-header">
    <div>
      <h1>Argument Map</h1>
      <p>Full-page exploration mode for structure, reasoning flow, and trust overlays.</p>
    </div>
    <button type="button" class="back-btn" onclick={backToWorkspace}>Back To Workspace</button>
  </header>

  <div class="map-page-shell">
    <MapTab onOpenReferences={openReferences} />
  </div>
</section>

<style>
  .map-page {
    min-height: calc(100vh - var(--nav-height));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .map-page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .map-page-header h1 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-h2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .map-page-header p {
    margin: 0;
    font-family: var(--font-ui);
    color: var(--color-dim);
    font-size: var(--text-meta);
  }

  .back-btn {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    white-space: nowrap;
  }

  .map-page-shell {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    overflow: hidden;
  }

  @media (max-width: 767px) {
    .map-page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
