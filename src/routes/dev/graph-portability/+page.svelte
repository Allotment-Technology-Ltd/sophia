<script lang="ts">
  /**
   * Portability smoke surface: mock GraphData + GraphCanvas only.
   * No SOPHIA stores, no graphDataFromSophiaGraphKit, no contracts types.
   */
  import { GraphCanvas } from '@restormel/ui-graph-svelte';
  import type { GraphData } from '@restormel/graph-core/viewModel';

  const mockGraph: GraphData = {
    nodes: [
      { id: 'mock:source:a', type: 'source', label: 'Portable source' },
      {
        id: 'mock:claim:b',
        type: 'claim',
        label: 'Portable claim',
        phase: 'analysis'
      }
    ],
    edges: [{ from: 'mock:source:a', to: 'mock:claim:b', type: 'contains' }],
    ghostNodes: [],
    ghostEdges: []
  };
</script>

<svelte:head>
  <title>Dev — Restormel Graph contract portability</title>
</svelte:head>

<section class="shell" aria-label="Graph portability proof">
  <header class="hdr">
    <h1>Restormel Graph — portability proof</h1>
    <p>
      Mock <code>GraphData</code> only. No adapter, no SOPHIA graph store. Manually verify zoom, pan,
      wheel zoom, and node focus/selection.
    </p>
  </header>
  <div class="canvas-wrap">
    <GraphCanvas
      nodes={mockGraph.nodes}
      edges={mockGraph.edges}
      ghostNodes={mockGraph.ghostNodes}
      ghostEdges={mockGraph.ghostEdges}
      showGhostLayer={false}
      showInlineDetail={false}
      showStatusChip={true}
      showViewportControls={true}
      nodeSemanticStyles={{}}
      edgeSemanticStyles={{}}
    />
  </div>
</section>

<style>
  .shell {
    min-height: 100vh;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .hdr h1 {
    margin: 0 0 8px;
    font-size: 1.25rem;
  }

  .hdr p {
    margin: 0;
    max-width: 72ch;
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .canvas-wrap {
    flex: 1;
    min-height: 480px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
</style>
