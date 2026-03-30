<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { WorldMapNode, WorldMapResponse } from '$lib/types/stoa';

  interface Props {
    open: boolean;
    data: WorldMapResponse;
    selectedNodeId?: string | null;
  }

  const dispatch = createEventDispatcher<{
    close: void;
    explore: { topic: string; nodeId: string };
  }>();

  let { open, data, selectedNodeId = null }: Props = $props();

  const selectedNode = $derived.by(() => {
    if (!selectedNodeId) return null;
    return data.nodes.find((node) => node.id === selectedNodeId) ?? null;
  });

  const relationshipLegend = $derived.by(() => {
    const edgeTypes = new Set(data.edges.map((edge) => edge.type));
    if (edgeTypes.size === 0) return ['taught', 'supports', 'contradicts', 'founded'];
    return Array.from(edgeTypes);
  });

  function closeMap(): void {
    dispatch('close');
  }

  function exploreSelectedNode(): void {
    if (!selectedNode) return;
    const topic = `Explore ${selectedNode.label} (${selectedNode.type})`;
    dispatch('explore', { topic, nodeId: selectedNode.id });
  }
</script>

{#if open}
  <section class="world-map-overlay" aria-label="World map overlay">
    <button type="button" class="scrim" onclick={closeMap} aria-label="Close world map"></button>

    <aside class="legend">
      <header>
        <h2>World Map</h2>
        <button type="button" class="close-button" onclick={closeMap}>Close</button>
      </header>

      <p class="hint">Drag to orbit. Click a node in the constellation to inspect it.</p>

      <div class="legend-block">
        <h3>Node Types</h3>
        <ul>
          <li><span class="dot thinker"></span> Thinker</li>
          <li><span class="dot framework"></span> Framework</li>
          <li><span class="dot concept"></span> Concept</li>
        </ul>
      </div>

      <div class="legend-block">
        <h3>Relationships</h3>
        <ul>
          {#each relationshipLegend as relation}
            <li>{relation}</li>
          {/each}
        </ul>
      </div>
    </aside>

    <section class="detail-panel" aria-live="polite">
      {#if selectedNode}
        <h3>{selectedNode.label}</h3>
        <p class="node-type">{selectedNode.type}</p>
        {#if selectedNode.details?.dates}
          <p class="meta">{selectedNode.details.dates}</p>
        {/if}
        {#if selectedNode.details?.description}
          <p>{selectedNode.details.description}</p>
        {/if}
        {#if selectedNode.details?.keyWorks && selectedNode.details.keyWorks.length > 0}
          <div>
            <h4>Key Works / Practice Uses</h4>
            <ul>
              {#each selectedNode.details.keyWorks as work}
                <li>{work}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if selectedNode.details?.misuseWarning}
          <p class="warning">Misuse warning: {selectedNode.details.misuseWarning}</p>
        {/if}

        <button type="button" class="explore-button" onclick={exploreSelectedNode}>
          Explore with STOA
        </button>
      {:else}
        <h3>Select a node</h3>
        <p>Choose a thinker, framework, or concept in the constellation to open details.</p>
      {/if}
    </section>
  </section>
{/if}

<style>
  .world-map-overlay {
    position: fixed;
    inset: 0;
    z-index: 25;
    pointer-events: none;
    display: grid;
    grid-template-columns: minmax(220px, 280px) 1fr minmax(280px, 360px);
    gap: 0;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(10, 12, 20, 0.55);
    backdrop-filter: blur(1px);
    pointer-events: auto;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .legend,
  .detail-panel {
    position: relative;
    margin: 24px;
    border: 1px solid rgba(170, 184, 215, 0.28);
    border-radius: 14px;
    background: rgba(14, 17, 26, 0.82);
    color: rgba(230, 237, 255, 0.92);
    pointer-events: auto;
    z-index: 1;
    padding: 16px;
  }

  .legend {
    grid-column: 1 / 2;
  }

  .detail-panel {
    grid-column: 3 / 4;
  }

  h2,
  h3,
  h4 {
    margin: 0;
    font-family: var(--font-ui);
    font-weight: 600;
  }

  h2 {
    font-size: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h3 {
    font-size: 16px;
  }

  h4 {
    margin-top: 12px;
    margin-bottom: 8px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(205, 216, 245, 0.8);
  }

  p,
  li {
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.45;
  }

  ul {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .close-button,
  .explore-button {
    border: 1px solid rgba(185, 145, 91, 0.5);
    border-radius: 10px;
    background: rgba(124, 84, 51, 0.24);
    color: rgba(239, 225, 200, 0.92);
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .close-button {
    padding: 6px 10px;
  }

  .explore-button {
    margin-top: 14px;
    width: 100%;
    min-height: 38px;
    padding: 8px 14px;
  }

  .hint {
    margin: 0 0 14px;
    color: rgba(193, 207, 237, 0.84);
  }

  .legend-block {
    margin-top: 14px;
  }

  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    margin-right: 8px;
  }

  .dot.thinker {
    background: #b87333;
  }

  .dot.framework {
    background: #9dbf99;
  }

  .dot.concept {
    background: #7aa8e8;
  }

  .node-type {
    margin: 6px 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(181, 202, 243, 0.82);
  }

  .meta {
    margin: 0 0 10px;
    color: rgba(214, 224, 250, 0.8);
  }

  .warning {
    margin-top: 12px;
    color: rgba(255, 188, 151, 0.9);
  }

  @media (max-width: 1024px) {
    .world-map-overlay {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto;
    }
    .legend {
      grid-column: 1;
      margin: 16px 16px 0;
    }
    .detail-panel {
      grid-column: 1;
      margin: 0 16px 16px;
    }
  }
</style>
