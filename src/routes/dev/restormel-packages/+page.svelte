<script lang="ts">
  /**
   * Restormel dogfood dashboard: one place to see which @restormel/* packages Sophia exercises
   * and to render live samples (context-packs, keys-svelte).
   */
  import { onMount } from 'svelte';
  import CostEstimator, { getProviderIcon } from '@restormel/keys-svelte';
  import '@restormel/keys-svelte/theme.css';
  import {
    demoKeysCostForDevPage,
    runRestormelPackageMatrixSmoke
  } from '$lib/restormel/sophiaRestormelPackageMatrix';
  import { buildPassSpecificContextPacks, type PassSpecificContextPacks } from '@restormel/context-packs';
  import { emptyGraphData } from '@restormel/graphrag-core';
  import { RESTORMEL_PROVIDERS_WORKSPACE } from '@restormel/providers';
  import { RESTORMEL_REASONING_CORE_WORKSPACE } from '@restormel/reasoning-core';
  import { GraphCanvas } from '@restormel/ui-graph-svelte';
  import type { GraphData } from '@restormel/graph-core/viewModel';

  type Row = { package: string; role: string; primaryTouchpoint: string };
  const matrixRows: Row[] = [
    {
      package: '@restormel/aaif',
      role: 'Request/response typing for edge AAIF',
      primaryTouchpoint: 'src/routes/api/beta/aaif, packages/aaif (workspace)'
    },
    {
      package: '@restormel/context-packs',
      role: 'Pass-specific retrieval → LLM context blocks',
      primaryTouchpoint: 'This page (live build), $lib/…/sophiaRestormelPackageMatrix, @restormel/state (peer)'
    },
    {
      package: '@restormel/contracts',
      role: 'Zod DTOs for graph, references, verification, …',
      primaryTouchpoint: 'Engine, API routes, graph kit (throughout $lib and routes)'
    },
    {
      package: '@restormel/graph-core',
      role: 'Graph view model + layout helpers',
      primaryTouchpoint: 'Graph kit, this page (empty GraphData for ui-graph-svelte sample)'
    },
    {
      package: '@restormel/graphrag-core (workspace)',
      role: 'Monorepo stub: empty GraphData helper',
      primaryTouchpoint: 'packages/graphrag-core, this page, sophiaRestormelPackageMatrix'
    },
    {
      package: '@restormel/graph-reasoning-extensions',
      role: 'Diff, lineage, projection, graph evaluation',
      primaryTouchpoint: 'Map tab, graphProjection, $lib/…/graph-reasoning-extensions-smoke.test.ts'
    },
    {
      package: '@restormel/keys',
      role: 'BYOK, pricing, provider catalog, dashboard helpers',
      primaryTouchpoint: 'restormel.ts, ingestLlmTokenUsdRates, key-manager, routing admin APIs'
    },
    {
      package: '@restormel/keys-svelte',
      role: 'Svelte 5 key manager / selector / cost UI (dogfood here)',
      primaryTouchpoint: 'This page: CostEstimator + icon helper (RestormelModelSelector uses @restormel/keys headless for product reasons)'
    },
    {
      package: '@restormel/observability',
      role: 'Trace + SSE event normalization',
      primaryTouchpoint: 'Verify API, conversation store, $lib/…/observability-consumer.test.ts'
    },
    {
      package: '@restormel/state',
      role: 'Append-only memory reducers, Stoa correlation',
      primaryTouchpoint: 'Stoa dialogue, state-debug API, sophiaRestormelPackageMatrix'
    },
    {
      package: '@restormel/reasoning-core (workspace)',
      role: 'Monorepo re-export of contracts/references for shared reasoning experiments',
      primaryTouchpoint: 'packages/reasoning-core, this page, sophiaRestormelPackageMatrix'
    },
    {
      package: '@restormel/providers (workspace)',
      role: 'Monorepo re-export of contracts/providers (BYOK + gates)',
      primaryTouchpoint: 'packages/providers, this page, sophiaRestormelPackageMatrix'
    },
    {
      package: '@restormel/ui-graph-svelte',
      role: 'Canvas for Restormel graph DTOs',
      primaryTouchpoint: 'GraphWorkspace, /dev/graph-portability (minimal), this page (tiny sample)'
    },
    {
      package: '@restormel/validate (devDependency)',
      role: 'Credential/config CLI (`pnpm run restormel:validate` prints --help)',
      primaryTouchpoint: 'package.json script, CI may extend with a real check config'
    },
    {
      package: '@restormel/mcp',
      role: 'MCP against Keys (operator workflows)',
      primaryTouchpoint: 'pnpm run mcp:restormel (dlx) — not bundled in the app'
    }
  ];

  let smoke = $state<ReturnType<typeof runRestormelPackageMatrixSmoke> | null>(null);
  let packs = $state<PassSpecificContextPacks | null>(null);
  const miniGraph: GraphData = {
    ...emptyGraphData(),
    nodes: [
      { id: 'd:node:1', type: 'source', label: 'Dogfood source' },
      { id: 'd:node:2', type: 'claim', label: 'Matrix claim', phase: 'analysis' }
    ],
    edges: [{ from: 'd:node:1', to: 'd:node:2', type: 'contains' }]
  };
  const openaiIcon = getProviderIcon('openai');

  onMount(() => {
    smoke = runRestormelPackageMatrixSmoke();
    packs = buildPassSpecificContextPacks(
      {
        claims: [
          {
            id: 'c1',
            text: 'Context packs work without the DB when payload is this small.',
            claim_type: 'thesis',
            source_title: 'Dogfood',
            confidence: 0.9
          }
        ],
        relations: [],
        arguments: [],
        seed_claim_ids: ['c1']
      },
      { depthMode: 'quick' }
    );
  });
</script>

<svelte:head>
  <title>Dev — Restormel package dogfood</title>
</svelte:head>

<main class="rp-shell">
  <header class="rp-hdr">
    <h1>Restormel package dogfood (Sophia test host)</h1>
    <p>
      This route exists so we continuously exercise published <code>@restormel/*</code> packages and
      in-repo workspace packages (<code>graphrag-core</code>, <code>reasoning-core</code>,
      <code>providers</code>, <code>aaif</code>). For graph portability only, see
      <a class="rp-a" href="/dev/graph-portability">/dev/graph-portability</a>.
    </p>
  </header>

  <section class="rp-sec" aria-labelledby="rp-badges">
    <h2 id="rp-badges">Workspace stubs</h2>
    <p>
      <code>RESTORMEL_PROVIDERS_WORKSPACE = {RESTORMEL_PROVIDERS_WORKSPACE}</code> ·
      <code>RESTORMEL_REASONING_CORE_WORKSPACE = {RESTORMEL_REASONING_CORE_WORKSPACE}</code>
    </p>
  </section>

  <section class="rp-sec" aria-labelledby="rp-smoke">
    <h2 id="rp-smoke">Import / smoke (also in vitest)</h2>
    {#if smoke}
      <ul class="rp-kv">
        <li>contextPacksBlocks: {smoke.contextPacksBlocks}</li>
        <li>keys provider count: {smoke.keysProviders}</li>
        <li>observability round-trip: {String(smoke.observabilityRoundTrip)}</li>
        <li>state projected: {String(smoke.stateProjected)}</li>
        <li>relation schema: {String(smoke.reasoningSchema)}</li>
      </ul>
    {:else}
      <p class="rp-muted">Running client smoke…</p>
    {/if}
  </section>

  <section class="rp-sec" aria-labelledby="rp-keys-svelte">
    <h2 id="rp-keys-svelte">@restormel/keys-svelte (CostEstimator + icon)</h2>
    <div class="rp-keys-row">
      <CostEstimator cost={demoKeysCostForDevPage} budget={5} estimatedCost={0.42} />
    </div>
    <p class="rp-muted">Provider icon (openai) length: {openaiIcon ? String(openaiIcon.length) : 0} chars (SVG string)</p>
  </section>

  <section class="rp-sec" aria-labelledby="rp-packs">
    <h2 id="rp-packs">@restormel/context-packs (live, one claim)</h2>
    {#if packs}
      <div class="rp-packs">
        <article>
          <h3>Analysis</h3>
          <pre class="rp-pre">{packs.analysis.block}</pre>
        </article>
        <article>
          <h3>Stats (analysis)</h3>
          <pre class="rp-pre">{JSON.stringify(packs.analysis.stats, null, 2)}</pre>
        </article>
      </div>
    {:else}
      <p class="rp-muted">Loading packs…</p>
    {/if}
  </section>

  <section class="rp-sec" aria-labelledby="rp-graph">
    <h2 id="rp-graph">@restormel/ui-graph-svelte + @restormel/graph-rag-core</h2>
    <p class="rp-muted">
      <code>emptyGraphData()</code> comes from the workspace; nodes below are a tiny <code>GraphData</code> for the
      canvas.
    </p>
    <div class="rp-canvas">
      <GraphCanvas
        nodes={miniGraph.nodes}
        edges={miniGraph.edges}
        ghostNodes={miniGraph.ghostNodes}
        ghostEdges={miniGraph.ghostEdges}
        showGhostLayer={false}
        showInlineDetail={false}
        showStatusChip={true}
        showViewportControls={true}
        nodeSemanticStyles={{}}
        edgeSemanticStyles={{}}
      />
    </div>
  </section>

  <section class="rp-sec" aria-labelledby="rp-matrix">
    <h2 id="rp-matrix">Package → use case</h2>
    <div class="rp-table-wrap" role="region" aria-label="Restormel packages table" tabindex="0">
      <table class="rp-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Role in Restormel</th>
            <th>Where Sophia uses it</th>
          </tr>
        </thead>
        <tbody>
          {#each matrixRows as row}
            <tr>
              <td><code>{row.package}</code></td>
              <td>{row.role}</td>
              <td>{row.primaryTouchpoint}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>

<style>
  .rp-shell {
    min-height: 100vh;
    padding: 1.25rem 1.5rem 2.5rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  .rp-hdr h1 {
    font-size: 1.35rem;
    margin: 0 0 0.5rem;
  }
  .rp-hdr p {
    margin: 0;
    color: var(--color-text-muted, #6b6b6b);
    line-height: 1.5;
  }
  .rp-hdr code,
  .rp-sec code {
    font-size: 0.85em;
  }
  .rp-sec {
    margin-top: 1.75rem;
  }
  .rp-sec h2 {
    font-size: 1.1rem;
    margin: 0 0 0.75rem;
  }
  .rp-a {
    color: var(--color-text-link, #1d4ed8);
  }
  .rp-kv {
    margin: 0;
    padding-left: 1.2rem;
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
  }
  .rp-keys-row {
    max-width: 32rem;
  }
  .rp-packs {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 720px) {
    .rp-packs {
      grid-template-columns: 1fr;
    }
  }
  .rp-pre {
    font-size: 0.8rem;
    line-height: 1.4;
    padding: 0.75rem;
    border: 1px solid var(--color-border, #e2e2e2);
    border-radius: 8px;
    overflow: auto;
    max-height: 12rem;
    background: var(--color-surface, #f9f9f9);
  }
  .rp-canvas {
    min-height: 400px;
    border: 1px solid var(--color-border, #e2e2e2);
    border-radius: 8px;
    overflow: hidden;
  }
  .rp-muted {
    color: var(--color-text-muted, #6b6b6b);
    font-size: 0.9rem;
  }
  .rp-table-wrap {
    overflow: auto;
    border: 1px solid var(--color-border, #e2e2e2);
    border-radius: 8px;
  }
  .rp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .rp-table th,
  .rp-table td {
    border-bottom: 1px solid var(--color-border, #e2e2e2);
    padding: 0.5rem 0.6rem;
    text-align: left;
    vertical-align: top;
  }
  .rp-table th {
    background: var(--color-surface, #f3f3f3);
  }
  .rp-table tr:last-child td {
    border-bottom: none;
  }
</style>
