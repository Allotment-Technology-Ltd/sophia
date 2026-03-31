<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { gsap } from 'gsap';
  import SplitType from 'split-type';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import type { CaveLandingSceneApi } from '$lib/marketing/caveLandingScene';
  import type { LandingAudioApi } from '$lib/marketing/landingAudio';

  let pageRoot: HTMLElement | null = null;
  let canvasHost: HTMLDivElement | null = null;
  let eyebrowEl: HTMLElement | null = null;
  let audioEnabled = false;
  let audioApiRef: LandingAudioApi | null = null;
  let layoutMode: 'compact' | 'editorial' = 'compact';

  beforeNavigate(() => {
    if (!pageRoot) return;
    gsap.to(pageRoot, { opacity: 0, duration: 0.28, ease: 'power2.out' });
  });

  async function toggleAudio(): Promise<void> {
    if (!audioApiRef) return;
    if (audioApiRef.isEnabled()) {
      audioApiRef.disable();
      audioEnabled = false;
      return;
    }
    await audioApiRef.unlockAndEnable();
    audioEnabled = audioApiRef.isEnabled();
  }

  function toggleLayoutMode(): void {
    layoutMode = layoutMode === 'compact' ? 'editorial' : 'compact';
  }

  onMount(() => {
    if (!canvasHost || !pageRoot) return () => {};

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let sceneApi: CaveLandingSceneApi | null = null;
    let audioApi: LandingAudioApi | null = null;
    let split: SplitType | null = null;
    let cleanupChoreo: (() => void) | null = null;

    void (async () => {
      const [{ createCaveLandingScene }, { createLandingAudio }, { createLandingChoreography }] =
        await Promise.all([
          import('$lib/marketing/caveLandingScene'),
          import('$lib/marketing/landingAudio'),
          import('$lib/marketing/landingChoreography')
        ]);

      sceneApi = await createCaveLandingScene(canvasHost);
      audioApi = createLandingAudio({ reducedMotion: reduced });
      audioApiRef = audioApi;
      audioEnabled = audioApi.isEnabled();

      if (!reduced && eyebrowEl) {
        split = new SplitType(eyebrowEl, { types: 'chars', tagName: 'span' });
      }

      cleanupChoreo = createLandingChoreography({
        root: pageRoot,
        sceneApi,
        reducedMotion: reduced,
        audioApi
      });
    })();

    return () => {
      split?.revert();
      cleanupChoreo?.();
      audioApi?.destroy();
      audioApiRef = null;
      sceneApi?.destroy();
    };
  });
</script>

<svelte:head>
  <title>SOPHIA — Cave landing (prototype)</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cave-root" class:layout-editorial={layoutMode === 'editorial'} bind:this={pageRoot}>
  <div class="canvas-host" bind:this={canvasHost} aria-hidden="true"></div>
  <div class="canvas-vignette" aria-hidden="true"></div>
  <p class="greek-watermark" aria-hidden="true">Σοφία</p>

  <header class="top intro-fade" aria-label="Prototype navigation">
    <p class="prototype-pill">Prototype · cinematic landing session</p>
    <a class="brand" href="/prototype/cave-landing">
      <DialecticalTriangle mode="logo" size={26} />
      <span class="brand-text">
        <span class="brand-name">SOPHIA</span>
        <span class="brand-greek" aria-hidden="true">Σοφία</span>
      </span>
    </a>
    <nav class="nav" aria-label="Links">
      <a href="/">Main site</a>
      <a href="/pricing">Pricing</a>
      <a href="/early-access">Sign In</a>
    </nav>
    <button class="audio-btn" type="button" onclick={toggleAudio}>
      Sound: {audioEnabled ? 'On' : 'Off'}
    </button>
    <button class="audio-btn" type="button" onclick={toggleLayoutMode}>
      Layout: {layoutMode === 'compact' ? 'Compact' : 'Editorial'}
    </button>
  </header>

  <main class="story">
    <section class="hero chapter" data-chapter="0.1" data-intensity="0.35">
      <div class="hero-copy">
        <p class="eyebrow intro-fade" bind:this={eyebrowEl}>
          A Space For Serious Thinkers To Learn, Question, And Grow
        </p>
        <h1 class="hero-title intro-fade">
          <span class="line-mask"><span class="hero-title-line">SOPHIA helps you learn to think -</span></span>
          <span class="line-mask"><span class="hero-title-line">and think to learn.</span></span>
        </h1>
        <p class="subhead intro-fade">
          Develop philosophical insight through guided lessons, essay feedback, and your own
          dialectical inquiries.
        </p>
        <div class="actions intro-fade">
          <a class="btn primary" href="/early-access">Sign In to Get Started</a>
          <a class="btn ghost" href="#pathways">See Learn + Inquire Paths</a>
        </div>
      </div>
    </section>

    <section class="chapter founder intro-fade" data-chapter="0.2" data-intensity="0.42">
      <div class="founder-strip">
        <p>
          Founder offer: the first 50 users receive 12 months of Premium plus £10 in starter wallet
          credit.
        </p>
        <a class="inline-link" href="/early-access">Sign in to claim founder access →</a>
      </div>
    </section>

    <section id="pathways" class="chapter block intro-fade" data-chapter="0.28" data-intensity="0.5">
      <h2 class="chapter-title">
        <span class="line-mask"><span class="line-text">How It Works</span></span>
      </h2>
      <p class="section-lead">
        One quick sign-in unlocks both modules. Choose Learn or Inquire from your dashboard, then
        switch any time.
      </p>
      <div class="pathways">
        <article class="path-card">
          <h3>🜂 Learn</h3>
          <p>
            Follow structured lessons on logic, ethics, and argumentation. Master the techniques of
            philosophical reasoning bit by bit.
          </p>
        </article>
        <article class="path-card">
          <h3>🜄 Inquire</h3>
          <p>
            Ask deep questions and follow analysis, critique, and synthesis as an interactive
            dialectic.
          </p>
        </article>
        <article class="path-card">
          <h3>🜁 Write &amp; Reflect</h3>
          <p>
            Submit short answers or essays. Receive constructive, source-aware feedback grounded in
            real philosophy.
          </p>
        </article>
      </div>
    </section>

    <section class="chapter block intro-fade" data-chapter="0.5" data-intensity="0.62">
      <h2 class="chapter-title">
        <span class="line-mask"><span class="line-text">The Learning Journey</span></span>
      </h2>
      <p class="section-lead">
        Start with simple drills that sharpen critical thinking. Progress to guided questions. Write
        short reflections, critique stronger thinkers, and build up to master-level essays - step by
        step, through a structured dialectical method.
      </p>
      <div class="journey-rail" aria-label="Learning progression">
        <span>Micro Drills</span>
        <span>Guided Inquiries</span>
        <span>Short Reflections</span>
        <span>Master Essays</span>
      </div>
      <a class="inline-link" href="/early-access">Sign in to explore the Philosophy Curriculum →</a>
    </section>

    <section class="chapter block intro-fade" data-chapter="0.76" data-intensity="0.78">
      <h2 class="chapter-title">
        <span class="line-mask"><span class="line-text">Example Interaction Preview</span></span>
      </h2>
      <p class="section-lead">
        Each inquiry becomes a learning moment, with structured reasoning patterns you can learn
        from.
      </p>
      <div class="preview-stack">
        <article class="preview-card analysis">
          <h3>Analysis</h3>
          <p>"Your argument rests on a utilitarian premise..."</p>
        </article>
        <article class="preview-card critique">
          <h3>Critique</h3>
          <p>"But does that premise hold under Kantian ethics?"</p>
        </article>
        <article class="preview-card synthesis">
          <h3>Synthesis</h3>
          <p>"A balanced view might treat consequences as partial, not primary."</p>
        </article>
      </div>
    </section>

    <section class="chapter block intro-fade" data-chapter="0.92" data-intensity="0.88">
      <h2 class="chapter-title">
        <span class="line-mask"><span class="line-text">Essay &amp; Feedback</span></span>
      </h2>
      <div class="essay-grid">
        <div>
          <p class="essay-heading">Excerpt from your writing</p>
          <blockquote>
            "Meaning is not discovered once; it is constructed through choices that expose our values
            under pressure."
          </blockquote>
        </div>
        <div>
          <p class="essay-heading">SOPHIA Review</p>
          <ul>
            <li>Analysis: Clear thesis, well-scaffolded.</li>
            <li>Critique: Assumptions around agency need refinement.</li>
            <li>Synthesis: Rephrase to align with existentialist view.</li>
          </ul>
          <a class="inline-link" href="/early-access">Get Feedback on Your Philosophy Writing →</a>
        </div>
      </div>
    </section>

    <section class="chapter block outro intro-fade" data-chapter="1" data-intensity="0.9">
      <h2 class="chapter-title">
        <span class="line-mask"><span class="line-text">SOPHIA + STOA</span></span>
      </h2>
      <p class="section-lead">
        Philosophy is learned through thinking - and thinking through dialogue. SOPHIA supports
        both.
      </p>
      <div class="actions">
        <a class="btn primary" href="/early-access">Start Your Journey</a>
        <a class="btn ghost" href="/">Back to Home</a>
      </div>
    </section>
  </main>
</div>

<style>
  .cave-root {
    position: relative;
    min-height: 100vh;
    z-index: 1;
    background: #030302;
    color: #ebe6d9;
    opacity: 1;
  }

  .canvas-host {
    position: fixed;
    inset: 0;
    z-index: 0;
  }

  .canvas-host :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .canvas-vignette {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(120% 92% at 50% 10%, rgba(3, 3, 2, 0.2), rgba(3, 3, 2, 0.9)),
      linear-gradient(180deg, rgba(3, 3, 2, 0.2), rgba(3, 3, 2, 0.84));
    z-index: 1;
    pointer-events: none;
    opacity: 0.7;
  }

  .prototype-pill {
    margin: 0;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(200, 216, 232, 0.2);
    background: rgba(8, 9, 6, 0.55);
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(235, 230, 217, 0.72);
  }

  .top {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: min(100% - 24px, 1160px);
    z-index: 4;
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    border: 1px solid rgba(200, 216, 232, 0.14);
    border-radius: 12px;
    backdrop-filter: blur(10px);
    background: rgba(5, 5, 4, 0.4);
  }

  .intro-fade {
    opacity: 0;
    transform: translateY(14px);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    color: inherit;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    line-height: 1;
  }

  .brand-name {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 1.2rem;
    letter-spacing: 0.12em;
    font-weight: 500;
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.8);
  }

  .brand-greek {
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(235, 230, 217, 0.45);
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .nav a {
    position: relative;
    color: rgba(235, 230, 217, 0.88);
    text-decoration: none;
    padding: 8px 0;
    text-shadow: 0 1px 16px rgba(0, 0, 0, 0.75);
  }

  .nav a::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 4px;
    height: 1px;
    background: #8a9e8c;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 240ms ease;
  }

  .nav a:hover::after,
  .nav a:focus-visible::after {
    transform: scaleX(1);
  }

  .audio-btn {
    min-height: 36px;
    border-radius: 8px;
    border: 1px solid rgba(200, 216, 232, 0.2);
    background: rgba(8, 9, 6, 0.45);
    color: rgba(235, 230, 217, 0.86);
    padding: 0 12px;
    font-family: var(--font-ui);
    font-size: 0.64rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .greek-watermark {
    position: fixed;
    top: 10vh;
    left: 50%;
    transform: translateX(-42%);
    margin: 0;
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-weight: 300;
    font-size: clamp(18vw, 20vw, 22vw);
    line-height: 0.85;
    letter-spacing: 0.04em;
    color: rgba(232, 226, 214, 0.035);
    pointer-events: none;
    user-select: none;
    z-index: 2;
  }

  .story {
    position: relative;
    z-index: 3;
    width: min(100% - 24px, 1160px);
    margin: 0 auto;
    padding-top: 100px;
    padding-bottom: 80px;
  }

  .hero,
  .chapter {
    min-height: 62vh;
    display: grid;
    align-items: center;
  }

  .hero {
    min-height: 100vh;
  }

  .founder {
    min-height: 34vh;
    align-items: start;
  }

  .hero-copy {
    max-width: 38rem;
    text-shadow: 0 2px 32px rgba(0, 0, 0, 0.85);
  }

  .eyebrow {
    margin: 0 0 16px;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #9eb0a0;
  }

  .hero-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 5.5vw, 3.6rem);
    font-weight: 400;
    line-height: 1.08;
    color: #f5f0e4;
  }

  .line-mask {
    display: block;
    overflow: hidden;
    padding-bottom: 2px;
  }

  .hero-title-line,
  .line-text {
    display: inline-block;
    transform: translateY(108%);
  }

  .subhead {
    margin: 20px 0 0;
    font-size: 1.05rem;
    line-height: 1.65;
    color: rgba(235, 230, 217, 0.82);
    max-width: 38ch;
  }

  .actions {
    margin-top: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .block {
    max-width: 44rem;
    margin-left: auto;
    padding: 18px;
    border-radius: 12px;
    border: 1px solid rgba(200, 216, 232, 0.16);
    background: rgba(5, 5, 4, 0.42);
    backdrop-filter: blur(6px);
  }

  .chapter-title {
    margin: 0 0 16px;
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 400;
    line-height: 1.04;
    color: #f5f0e4;
  }

  .block p {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.72;
    color: rgba(235, 230, 217, 0.86);
  }

  .section-lead {
    margin: 0 0 12px;
    font-size: 0.9rem;
    line-height: 1.56;
    color: rgba(235, 230, 217, 0.8);
    max-width: 58ch;
  }

  .pathways {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .path-card {
    border: 1px solid rgba(200, 216, 232, 0.18);
    border-radius: 8px;
    background: rgba(3, 3, 2, 0.44);
    padding: 7px 8px;
  }

  .path-card h3 {
    margin: 0 0 5px;
    color: #8a9e8c;
    font-family: var(--font-ui);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.2;
  }

  .path-card p {
    margin: 0;
    color: rgba(235, 230, 217, 0.82);
    font-size: 0.67rem;
    line-height: 1.34;
  }

  .journey-rail {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .journey-rail span {
    border: 1px solid rgba(200, 216, 232, 0.18);
    border-radius: 999px;
    padding: 5px 8px;
    text-align: center;
    font-family: var(--font-ui);
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(235, 230, 217, 0.74);
  }

  .preview-stack {
    display: grid;
    gap: 7px;
  }

  .preview-card {
    border: 1px solid rgba(200, 216, 232, 0.16);
    border-radius: 8px;
    background: rgba(3, 3, 2, 0.4);
    padding: 8px 10px;
  }

  .preview-card.analysis { border-left: 3px solid #8a9e8c; }
  .preview-card.critique { border-left: 3px solid #6e7ea8; }
  .preview-card.synthesis { border-left: 3px solid #c4935a; }

  .preview-card h3 {
    margin: 0 0 4px;
    font-size: 0.68rem;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .preview-card p {
    margin: 0;
    color: rgba(235, 230, 217, 0.82);
    font-size: 0.76rem;
    line-height: 1.4;
  }

  .layout-editorial .block {
    max-width: 54rem;
    padding: 24px;
  }

  .layout-editorial .pathways {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .layout-editorial .path-card {
    padding: 12px;
  }

  .layout-editorial .path-card p {
    font-size: 0.94rem;
    line-height: 1.58;
  }

  .outro {
    margin-bottom: 16vh;
  }

  .founder-strip {
    border: 1px solid rgba(138, 158, 140, 0.24);
    border-radius: 10px;
    padding: 10px 12px;
    background:
      linear-gradient(96deg, rgba(30, 35, 24, 0.86), rgba(31, 36, 26, 0.94), rgba(40, 47, 33, 0.84));
    background-size: 160% 100%;
    animation: founderShift 12s ease-in-out infinite alternate;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }

  .founder-strip p {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(235, 230, 217, 0.9);
    line-height: 1.4;
  }

  .inline-link {
    color: #8a9e8c;
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 0.64rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .essay-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .essay-heading {
    margin: 0 0 7px;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.6rem;
    color: #8a9e8c;
  }

  blockquote {
    margin: 0;
    border: 1px solid rgba(200, 216, 232, 0.15);
    border-radius: 8px;
    background: rgba(3, 3, 2, 0.35);
    padding: 8px 10px;
    color: rgba(235, 230, 217, 0.82);
    font-size: 0.74rem;
    line-height: 1.42;
  }

  ul {
    margin: 0;
    padding-left: 16px;
    color: rgba(235, 230, 217, 0.82);
    font-size: 0.72rem;
    line-height: 1.42;
  }

  @keyframes founderShift {
    from {
      background-position: 0% 50%;
    }
    to {
      background-position: 100% 50%;
    }
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 8px 20px;
    border-radius: 10px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-decoration: none;
    transition:
      transform 180ms ease,
      border-color 180ms ease,
      background 180ms ease;
  }

  .btn:hover {
    transform: translateY(-2px);
  }

  .btn.primary {
    background: #8a9e8c;
    color: #0f1009;
    border: 1px solid transparent;
  }

  .btn.ghost {
    background: rgba(6, 7, 5, 0.45);
    border: 1px solid rgba(200, 216, 232, 0.22);
    color: #ebe6d9;
  }

  @media (max-width: 767px) {
    .top {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        'pill pill'
        'brand audio'
        'nav nav'
        'layout layout';
      gap: 10px;
    }

    .prototype-pill {
      grid-area: pill;
      justify-self: start;
    }

    .brand {
      grid-area: brand;
    }

    .audio-btn {
      grid-area: audio;
      justify-self: end;
    }

    .nav {
      grid-area: nav;
      gap: 12px;
    }

    .top .audio-btn:last-child {
      grid-area: layout;
      justify-self: start;
    }

    .greek-watermark {
      font-size: 28vw;
      top: 14vh;
    }

    .hero-copy {
      max-width: 100%;
    }

    .actions .btn {
      width: 100%;
    }

    .block {
      margin-left: 0;
      padding: 20px;
    }

    .pathways {
      grid-template-columns: 1fr;
    }

    .journey-rail {
      grid-template-columns: 1fr;
    }

    .essay-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .intro-fade,
    .hero-title-line,
    .line-text {
      opacity: 1 !important;
      transform: none !important;
    }
  }
</style>
