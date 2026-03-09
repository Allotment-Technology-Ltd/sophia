<script lang="ts">
  interface Props {
    mode: 'logo' | 'loading' | 'complete';
    currentPass?: string | null;
    completedPasses?: string[];
    size?: number;
    onReveal?: () => void;
  }

  let {
    mode,
    currentPass = null,
    completedPasses = [],
    size = 240,
    onReveal,
  }: Props = $props();

  // SVG coordinate space: viewBox="-60 -70 120 130"
  // A = (0, -45)   top,          sage    (Analysis)
  // C = (39, 22)   bottom-right, copper  (Critique)
  // S = (-39, 22)  bottom-left,  blue    (Synthesis)
  // O = (0, 0)     centre,       amber

  // Edge lengths in SVG units
  const LEN_AC = Math.sqrt(39 ** 2 + 67 ** 2); // A→C ≈ 77.52
  const LEN_CS = 78;                             // C→S
  const LEN_SA = LEN_AC;                         // S→A ≈ 77.52

  // Pass state
  const isAnalysisActive  = $derived(currentPass === 'analysis');
  const isCritiqueActive  = $derived(currentPass === 'critique');
  const isSynthesisActive = $derived(currentPass === 'synthesis');

  const isAnalysisDone  = $derived(completedPasses.includes('analysis'));
  const isCritiqueDone  = $derived(completedPasses.includes('critique'));
  const isSynthesisDone = $derived(completedPasses.includes('synthesis'));

  // Edge highlights are gated on completed transitions, not active-node start.
  const showAC = $derived(
    mode === 'logo' ||
    mode === 'complete' ||
    ((isAnalysisDone || currentPass === 'critique' || currentPass === 'synthesis') && currentPass !== 'analysis')
  );
  const showCS = $derived(
    mode === 'logo' ||
    mode === 'complete' ||
    ((isCritiqueDone || currentPass === 'synthesis') && currentPass !== 'critique')
  );
  const showSA = $derived(
    mode === 'logo' ||
    mode === 'complete' ||
    (isSynthesisDone && currentPass !== 'synthesis')
  );

  // Edge offsets: length = hidden, 0 = fully drawn
  const edgeACOffset = $derived(showAC ? 0 : LEN_AC);
  const edgeCSOffset = $derived(showCS ? 0 : LEN_CS);
  const edgeSAOffset = $derived(showSA ? 0 : LEN_SA);

  // Node opacity: 0.2 idle, 1 active, 0.65 done, 0.6 logo
  const opacityA = $derived(
    mode === 'logo'     ? 0.6
    : mode === 'complete'   ? 0.85
    : isAnalysisActive  ? 1
    : isAnalysisDone    ? 0.65
    : 0.2
  );
  const opacityC = $derived(
    mode === 'logo'    ? 0.6
    : mode === 'complete'  ? 0.85
    : isCritiqueActive ? 1
    : isCritiqueDone   ? 0.65
    : 0.2
  );
  const opacityS = $derived(
    mode === 'logo'     ? 0.6
    : mode === 'complete'   ? 0.85
    : isSynthesisActive ? 1
    : isSynthesisDone   ? 0.65
    : 0.2
  );

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
  <svg
    role={mode === 'complete' ? 'button' : 'img'}
    aria-label={mode === 'complete'
      ? 'Dialectical analysis complete — click to reveal results'
      : 'Sophia dialectical triangle'}
    tabindex={mode === 'complete' ? 0 : undefined}
    width={size}
    height={size}
    viewBox="-60 -70 120 130"
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

    <!-- ── Triangle skeleton (always visible in loading/complete/logo) ───── -->
    <line
      class="edge-skeleton"
      x1="0" y1="-45" x2="39" y2="22"
      stroke="var(--color-sage)"
      stroke-width="0.8"
      stroke-linecap="round"
    />
    <line
      class="edge-skeleton"
      x1="39" y1="22" x2="-39" y2="22"
      stroke="var(--color-copper)"
      stroke-width="0.8"
      stroke-linecap="round"
    />
    <line
      class="edge-skeleton"
      x1="-39" y1="22" x2="0" y2="-45"
      stroke="var(--color-blue)"
      stroke-width="0.8"
      stroke-linecap="round"
    />

    <!-- ── Active edge highlights (light up on pass completion) ──────────── -->

    <!-- A→C (sage / analysis) -->
    <line
      class="edge"
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
      x1="-39" y1="22" x2="0" y2="-45"
      stroke="var(--color-blue)"
      stroke-width="0.8"
      stroke-linecap="round"
      stroke-dasharray={LEN_SA}
      stroke-dashoffset={edgeSAOffset}
    />

    <!-- ── Convergence lines (complete mode only) ─────────────── -->
    {#if mode === 'complete'}
      <line class="conv-line" x1="0" y1="-45" x2="0" y2="0"
        stroke="var(--color-sage)" stroke-width="0.5" stroke-opacity="0.55" />
      <line class="conv-line" x1="39" y1="22" x2="0" y2="0"
        stroke="var(--color-copper)" stroke-width="0.5" stroke-opacity="0.55"
        style="animation-delay: 0.15s" />
      <line class="conv-line" x1="-39" y1="22" x2="0" y2="0"
        stroke="var(--color-blue)" stroke-width="0.5" stroke-opacity="0.55"
        style="animation-delay: 0.3s" />
    {/if}

    <!-- ── Nodes ───────────────────────────────────────────────── -->

    <!-- A — Analysis (top, sage) -->
    <circle
      class="node"
      class:node-active={isAnalysisActive}
      cx="0" cy="-45" r="4"
      fill="var(--color-sage)"
      opacity={opacityA}
      filter={isAnalysisActive ? 'url(#glow-sage-dt)' : undefined}
    />

    <!-- C — Critique (bottom-right, copper) -->
    <circle
      class="node"
      class:node-active={isCritiqueActive}
      cx="39" cy="22" r="4"
      fill="var(--color-copper)"
      opacity={opacityC}
      filter={isCritiqueActive ? 'url(#glow-copper-dt)' : undefined}
    />

    <!-- S — Synthesis (bottom-left, blue) -->
    <circle
      class="node"
      class:node-active={isSynthesisActive}
      cx="-39" cy="22" r="4"
      fill="var(--color-blue)"
      opacity={opacityS}
      filter={isSynthesisActive ? 'url(#glow-blue-dt)' : undefined}
    />

    <!-- Labels: single-letter in loading/complete, hidden in logo -->
    {#if mode !== 'logo'}
      <text class="lbl" x="0" y="-52" text-anchor="middle"
        fill="var(--color-sage)" opacity={opacityA}>A</text>
      <text class="lbl" x="46" y="27" text-anchor="start"
        fill="var(--color-copper)" opacity={opacityC}>C</text>
      <text class="lbl" x="-46" y="27" text-anchor="end"
        fill="var(--color-blue)" opacity={opacityS}>S</text>
    {/if}

    <!-- Centre dot (complete mode) -->
    {#if mode === 'complete'}
      <circle
        class="centre-dot"
        cx="0" cy="0" r="5"
        fill="var(--color-amber)"
        filter="url(#glow-amber-dt)"
      />
    {/if}
  </svg>

  {#if mode === 'complete'}
    <p class="reveal-hint" aria-hidden="true">click to reveal ↓</p>
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

  /* Edge draw-in transition */
  .edge {
    transition: stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.95;
  }

  .edge-skeleton {
    opacity: 0.2;
  }

  /* Hover wobble on edges in complete mode */
  .tri-svg.is-complete:hover .edge {
    animation: edgeWobble 2s ease-in-out infinite;
  }

  .node {
    transition: opacity 0.6s ease;
  }

  .node-active {
    animation: nodeGlow 2s ease-in-out infinite;
  }

  /* Convergence lines draw in on mount */
  .conv-line {
    stroke-dasharray: 50;
    animation: convDraw 0.7s cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .centre-dot {
    animation: centerPulse 2.5s ease-in-out infinite;
  }

  .lbl {
    font-family: var(--font-ui);
    font-size: 5px;
    letter-spacing: 0.12em;
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
    50%       { opacity: 0.65; }
  }

  @keyframes convDraw {
    from { stroke-dashoffset: 50; }
    to   { stroke-dashoffset: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .edge                              { transition: none; }
    .node-active                       { animation: none; }
    .centre-dot                        { animation: none; }
    .conv-line                         { animation: none; stroke-dashoffset: 0; }
    .tri-svg.is-complete:hover .edge   { animation: none; }
    .reveal-hint                        { animation: none; }
  }
</style>
