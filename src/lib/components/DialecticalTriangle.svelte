<script lang="ts">
  import { DIALECTICAL_EDGE_LEN } from '$lib/marketing/dialecticalTriangleGeometry';

  interface Props {
    mode: 'logo' | 'loading' | 'complete';
    currentPass?: string | null;
    startedPasses?: string[];
    completedPasses?: string[];
    depthMode?: 'quick' | 'standard' | 'deep';
    completionReady?: boolean;
    size?: number;
    onReveal?: () => void;
  }

  let {
    mode,
    currentPass = null,
    startedPasses = [],
    completedPasses = [],
    depthMode = 'standard',
    completionReady = false,
    size = 240,
    onReveal,
  }: Props = $props();

  // SVG coordinate space: viewBox="-68 -76 136 140" (extra padding for vertex labels)
  // Analysis vertex  = (0, -45)   top,          sage
  // Critique vertex  = (39, 22)   bottom-right, copper
  // Synthesis vertex = (-39, 22)  bottom-left,  blue
  // O = (0, 0)     centre,       amber

  // Edge lengths in SVG units (canonical: dialecticalTriangleGeometry.ts)
  const { LEN_AC, LEN_CS, LEN_SA, LEN_AO, LEN_CO, LEN_SO } = DIALECTICAL_EDGE_LEN;

  // Pass state
  const isAnalysisActive  = $derived(currentPass === 'analysis');
  const isCritiqueActive  = $derived(currentPass === 'critique');
  const isSynthesisActive = $derived(currentPass === 'synthesis');

  const isAnalysisDone  = $derived(completedPasses.includes('analysis'));
  const isCritiqueDone  = $derived(completedPasses.includes('critique'));
  const isSynthesisDone = $derived(completedPasses.includes('synthesis'));
  const isAnalysisStarted = $derived(startedPasses.includes('analysis'));
  const isCritiqueStarted = $derived(startedPasses.includes('critique'));
  const isSynthesisStarted = $derived(startedPasses.includes('synthesis'));

  const isQuickDepth = $derived(depthMode === 'quick');

  // Keep the active branch visible while each pass is running so loading
  // reads as an active dialectical process rather than a static scaffold.
  const showFullTriangle = $derived(mode === 'complete' && !isQuickDepth);
  const showAC = $derived(
    mode === 'logo' || isAnalysisActive || isAnalysisStarted || isAnalysisDone || showFullTriangle
  );
  const showCS = $derived(
    mode === 'logo' || isCritiqueActive || isCritiqueStarted || isCritiqueDone || showFullTriangle
  );
  const showSA = $derived(
    mode === 'logo' || isSynthesisActive || isSynthesisStarted || isSynthesisDone || showFullTriangle
  );
  const showAO = $derived(mode === 'logo' || mode === 'complete' || isAnalysisActive || isAnalysisStarted || isAnalysisDone);
  const showCO = $derived(mode === 'logo' || isCritiqueActive || isCritiqueStarted || isCritiqueDone || showFullTriangle);
  const showSO = $derived(mode === 'logo' || isSynthesisActive || isSynthesisStarted || isSynthesisDone || showFullTriangle);

  const isAnalysisEdgeActive = $derived(mode === 'loading' && isAnalysisActive);
  const isCritiqueEdgeActive = $derived(mode === 'loading' && isCritiqueActive);
  const isSynthesisEdgeActive = $derived(mode === 'loading' && isSynthesisActive);

  // Edge offsets: length = hidden, 0 = fully drawn
  const edgeACOffset = $derived(showAC ? 0 : LEN_AC);
  const edgeCSOffset = $derived(showCS ? 0 : LEN_CS);
  const edgeSAOffset = $derived(showSA ? 0 : LEN_SA);
  const edgeAOOffset = $derived(showAO ? 0 : LEN_AO);
  const edgeCOOffset = $derived(showCO ? 0 : LEN_CO);
  const edgeSOOffset = $derived(showSO ? 0 : LEN_SO);

  // Node opacity: 0.25 idle, 1 active, 0.82 done, 0.6 logo
  const opacityA = $derived(
    mode === 'logo' ? 0.6
      : mode === 'complete'
        ? (isQuickDepth ? (isAnalysisDone ? 0.95 : 0.25) : 0.9)
        : isAnalysisActive ? 1
          : isAnalysisDone ? 0.82
            : 0.25
  );
  const opacityC = $derived(
    mode === 'logo' ? 0.6
      : mode === 'complete'
        ? (isQuickDepth ? 0.25 : 0.9)
        : isCritiqueActive ? 1
          : isCritiqueDone ? 0.82
            : 0.25
  );
  const opacityS = $derived(
    mode === 'logo' ? 0.6
      : mode === 'complete'
        ? (isQuickDepth ? 0.25 : 0.9)
        : isSynthesisActive ? 1
          : isSynthesisDone ? 0.82
            : 0.25
  );
  const isCenterLit = $derived(mode === 'complete' || completionReady);
  const centerOpacity = $derived(
    mode === 'logo' ? 0.28
      : mode === 'complete' ? 0.95
        : isCenterLit ? 0.82
          : 0.35
  );
  const centerFill = $derived(isCenterLit ? 'var(--color-amber)' : 'var(--color-border)');

  let hovering = $state(false);

  function handleClick() {
    if (mode === 'complete') onReveal?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (mode === 'complete' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onReveal?.();
    }
  }
</script>

<div class="tri-wrap">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <svg
    role={mode === 'complete' ? 'button' : 'img'}
    aria-label={mode === 'complete'
      ? 'Dialectical analysis complete — click to reveal results'
      : 'Sophia dialectical triangle'}
    tabindex={mode === 'complete' ? 0 : undefined}
    width={size}
    height={size}
    viewBox="-68 -76 136 140"
    fill="none"
    class="tri-svg"
    class:is-complete={mode === 'complete'}
    style:filter={hovering && mode === 'complete' ? 'url(#chromatic-sophia)' : undefined}
    onclick={handleClick}
    onkeydown={handleKeydown}
    onmouseenter={() => { if (mode === 'complete') hovering = true; }}
    onmouseleave={() => { hovering = false; }}
  >
    <defs>
      <!-- Chromatic aberration on hover (complete mode) -->
      <filter id="chromatic-sophia" x="-30%" y="-30%" width="160%" height="160%">
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
        <feOffset dx="3" dy="0" in="r" result="r-off" />
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
        <feOffset dx="-3" dy="0" in="b" result="b-off" />
        <feMerge>
          <feMergeNode in="r-off" />
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="b-off" />
        </feMerge>
      </filter>

      <!-- Node glow filters -->
      <filter id="glow-sage-dt" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="glow-copper-dt" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="glow-blue-dt" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="glow-amber-dt" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <!-- ── Triangle skeleton (always visible) ─────────────────────────────── -->
    <line
      class="edge-skeleton"
      x1="0" y1="-45" x2="39" y2="22"
      stroke="var(--color-border)"
      stroke-width="0.8"
      stroke-linecap="round"
    />
    <line
      class="edge-skeleton"
      x1="39" y1="22" x2="-39" y2="22"
      stroke="var(--color-border)"
      stroke-width="0.8"
      stroke-linecap="round"
    />
    <line
      class="edge-skeleton"
      x1="-39" y1="22" x2="0" y2="-45"
      stroke="var(--color-border)"
      stroke-width="0.8"
      stroke-linecap="round"
    />

    <!-- Internal skeleton stays visible through all states -->
    <line
      class="internal-skeleton"
      x1="0" y1="-45" x2="0" y2="0"
      stroke="var(--color-border)"
      stroke-width="0.6"
      stroke-linecap="round"
    />
    <line
      class="internal-skeleton"
      x1="39" y1="22" x2="0" y2="0"
      stroke="var(--color-border)"
      stroke-width="0.6"
      stroke-linecap="round"
    />
    <line
      class="internal-skeleton"
      x1="-39" y1="22" x2="0" y2="0"
      stroke="var(--color-border)"
      stroke-width="0.8"
      stroke-linecap="round"
    />

    <!-- ── Colored branches stay active while each pass runs ──────────────── -->

    <!-- A→C (sage / analysis) -->
    <line
      class="edge"
      class:edge-active={isAnalysisEdgeActive}
      x1="0" y1="-45" x2="39" y2="22"
      stroke="var(--color-sage)"
      stroke-width="0.8"
      stroke-linecap="round"
      stroke-dasharray={LEN_AC}
      stroke-dashoffset={edgeACOffset}
    />

    <!-- C→S (copper / critique) -->
    <line
      class="edge"
      class:edge-active={isCritiqueEdgeActive}
      x1="39" y1="22" x2="-39" y2="22"
      stroke="var(--color-copper)"
      stroke-width="0.8"
      stroke-linecap="round"
      stroke-dasharray={LEN_CS}
      stroke-dashoffset={edgeCSOffset}
    />

    <!-- S→A (blue / synthesis) -->
    <line
      class="edge"
      class:edge-active={isSynthesisEdgeActive}
      x1="-39" y1="22" x2="0" y2="-45"
      stroke="var(--color-blue)"
      stroke-width="0.8"
      stroke-linecap="round"
      stroke-dasharray={LEN_SA}
      stroke-dashoffset={edgeSAOffset}
    />

    <!-- A→O / C→O / S→O colored draws -->
    <line
      class="edge edge-inner"
      class:edge-active={isAnalysisEdgeActive}
      x1="0" y1="-45" x2="0" y2="0"
      stroke="var(--color-sage)"
      stroke-width="0.6"
      stroke-linecap="round"
      stroke-dasharray={LEN_AO}
      stroke-dashoffset={edgeAOOffset}
    />
    <line
      class="edge edge-inner"
      class:edge-active={isCritiqueEdgeActive}
      x1="39" y1="22" x2="0" y2="0"
      stroke="var(--color-copper)"
      stroke-width="0.6"
      stroke-linecap="round"
      stroke-dasharray={LEN_CO}
      stroke-dashoffset={edgeCOOffset}
    />
    <line
      class="edge edge-inner"
      class:edge-active={isSynthesisEdgeActive}
      x1="-39" y1="22" x2="0" y2="0"
      stroke="var(--color-blue)"
      stroke-width="0.6"
      stroke-linecap="round"
      stroke-dasharray={LEN_SO}
      stroke-dashoffset={edgeSOOffset}
    />

    <!-- ── Nodes ───────────────────────────────────────────────── -->

    <!-- A — Analysis (top, sage) -->
    <circle
      class="node"
      class:node-active={isAnalysisActive}
      class:node-lit={isAnalysisDone || (mode === 'complete' && !isQuickDepth)}
      cx="0" cy="-45" r="4"
      fill="var(--color-sage)"
      opacity={opacityA}
      filter={isAnalysisActive || isAnalysisDone || (mode === 'complete' && !isQuickDepth) ? 'url(#glow-sage-dt)' : undefined}
    />

    <!-- C — Critique (bottom-right, copper) -->
    <circle
      class="node"
      class:node-active={isCritiqueActive}
      class:node-lit={isCritiqueDone || (mode === 'complete' && !isQuickDepth)}
      cx="39" cy="22" r="4"
      fill="var(--color-copper)"
      opacity={opacityC}
      filter={isCritiqueActive || isCritiqueDone || (mode === 'complete' && !isQuickDepth) ? 'url(#glow-copper-dt)' : undefined}
    />

    <!-- S — Synthesis (bottom-left, blue) -->
    <circle
      class="node"
      class:node-active={isSynthesisActive}
      class:node-lit={isSynthesisDone || (mode === 'complete' && !isQuickDepth)}
      cx="-39" cy="22" r="4"
      fill="var(--color-blue)"
      opacity={opacityS}
      filter={isSynthesisActive || isSynthesisDone || (mode === 'complete' && !isQuickDepth) ? 'url(#glow-blue-dt)' : undefined}
    />

    <!-- Vertex labels: loading/complete only; hidden in logo -->
    {#if mode !== 'logo'}
      <text class="lbl" x="0" y="-56" text-anchor="middle"
        fill="var(--color-sage)" opacity={opacityA}>Analysis</text>
      <text class="lbl" x="50" y="30" text-anchor="start"
        fill="var(--color-copper)" opacity={opacityC}>Critique</text>
      <text class="lbl" x="-50" y="30" text-anchor="end"
        fill="var(--color-blue)" opacity={opacityS}>Synthesis</text>
    {/if}

    <!-- Centre dot skeleton always visible -->
    <circle
      class="centre-dot"
      class:lit={isCenterLit}
      cx="0" cy="0" r="5"
      fill={centerFill}
      opacity={centerOpacity}
      filter={isCenterLit ? 'url(#glow-amber-dt)' : undefined}
    />
  </svg>

  {#if mode === 'complete'}
    <p class="reveal-hint" aria-hidden="true">click to reveal →</p>
  {/if}
</div>

<style>
  .tri-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .tri-svg {
    display: block;
    overflow: visible;
  }

  .tri-svg.is-complete {
    cursor: pointer;
  }

  .edge {
    transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.95;
  }

  .edge-skeleton {
    opacity: 0.4;
  }

  .internal-skeleton {
    opacity: 0.36;
  }

  .edge-inner {
    opacity: 0.85;
  }

  .edge-active {
    animation: edgePulse 1.8s ease-in-out infinite;
  }

  /* Hover wobble on edges in complete mode */
  .tri-svg.is-complete:hover .edge {
    animation: edgeWobble 2s ease-in-out infinite;
  }

  .node {
    transition: opacity 0.6s ease, transform 0.4s ease;
  }

  .node-lit {
    transform: scale(1.03);
  }

  .node-active {
    animation: nodeGlow 1.8s ease-in-out infinite;
  }

  .centre-dot {
    transition: opacity 0.4s ease, fill 0.4s ease;
  }

  .centre-dot.lit {
    animation: centerPulse 2.4s ease-in-out infinite;
  }

  .lbl {
    font-family: var(--font-ui);
    font-size: 4.25px;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition: opacity 0.4s ease;
  }

  .reveal-hint {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-dim);
    margin: 0;
    cursor: pointer;
    animation: fadeInUp 0.6s 0.5s ease both;
  }

  @keyframes nodeGlow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.75; }
  }

  @keyframes centerPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes edgeWobble {
    0%, 100% { opacity: 0.95; }
    50% { opacity: 0.78; }
  }

  @keyframes edgePulse {
    0%, 100% { opacity: 0.95; }
    50% { opacity: 0.62; }
  }

  @media (prefers-reduced-motion: reduce) {
    .edge                              { transition: none; }
    .edge-active                       { animation: none; }
    .node-active                       { animation: none; }
    .centre-dot                        { animation: none; }
    .tri-svg.is-complete:hover .edge   { animation: none; }
    .reveal-hint                        { animation: none; }
  }
</style>
