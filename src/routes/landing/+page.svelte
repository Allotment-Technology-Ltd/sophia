<script lang="ts">
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import PublicHeader from '$lib/components/shell/PublicHeader.svelte';
</script>

<svelte:head>
  <title>Learn Through Reasoning. Think Through Philosophy.</title>
  <meta
    name="description"
    content="SOPHIA helps you build clearer ideas through lessons, inquiry, and writing feedback grounded in philosophical discipline."
  />
</svelte:head>

<main class="marketing-page sophia-page-shell">
  <PublicHeader
    links={[
      { href: '#learn-track', label: 'Learn' },
      { href: '#inquire-track', label: 'Think' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/auth', label: 'Sign In' }
    ]}
  />

  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy">
      <p class="eyebrow">A Space For Serious Thinkers To Learn, Question, And Grow</p>
      <h1 id="hero-title">SOPHIA helps you learn to think - and think to learn.</h1>
      <p class="subhead">
        Develop philosophical insight through guided lessons, essay feedback, and your own
        dialectical inquiries.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="/auth">Sign In to Get Started</a>
        <a class="btn secondary" href="#how-it-works-title">See Learn + Inquire Paths</a>
      </div>
      <p class="microcopy">
        One quick sign-in unlocks both modules. Choose Learn or Inquire from your dashboard, then
        switch any time.
      </p>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="hero-orb"></div>
      <DialecticalTriangle mode="logo" size={196} />
    </div>
  </section>

  <section class="founder-strip" aria-label="Founder offer">
    <p>
      Founder offer: the first 50 users receive 12 months of Premium plus £10 in starter wallet
      credit.
    </p>
    <a class="inline-link" href="/auth">Sign in to claim founder access →</a>
  </section>

  <section id="learn-track" class="panel" aria-labelledby="how-it-works-title">
    <h2 id="how-it-works-title">How It Works</h2>
    <div class="cards-3">
      <article class="info-card">
        <p class="glyph">🜂 Learn</p>
        <p>
          Follow structured lessons on logic, ethics, and argumentation. Master the techniques of
          philosophical reasoning bit by bit.
        </p>
      </article>
      <article class="info-card">
        <p class="glyph">🜄 Inquire</p>
        <p>
          Ask deep questions and follow analysis, critique, and synthesis as an interactive
          dialectic.
        </p>
      </article>
      <article class="info-card">
        <p class="glyph">🜁 Write &amp; Reflect</p>
        <p>
          Submit short answers or essays. Receive constructive, source-aware feedback grounded in
          real philosophy.
        </p>
      </article>
    </div>
  </section>

  <section class="journey" aria-labelledby="journey-title">
    <h2 id="journey-title">The Learning Journey</h2>
    <p>
      Start with simple drills that sharpen critical thinking. Progress to guided questions. Write
      short reflections, critique stronger thinkers, and build up to master-level essays - step by
      step, through a structured dialectical method.
    </p>
    <div class="timeline" aria-label="Learning progression">
      <span>Micro Drills</span>
      <span>Guided Inquiries</span>
      <span>Short Reflections</span>
      <span>Master Essays</span>
    </div>
    <a class="inline-link" href="/auth">Sign in to explore the Philosophy Curriculum →</a>
  </section>

  <section id="inquire-track" class="panel" aria-labelledby="preview-title">
    <h2 id="preview-title">Example Interaction Preview</h2>
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
    <p class="section-note">
      Each inquiry becomes a learning moment, with structured reasoning patterns you can learn
      from.
    </p>
  </section>

  <section class="essay" aria-labelledby="essay-title">
    <div>
      <h2 id="essay-title">Essay &amp; Feedback</h2>
      <p class="essay-heading">Excerpt from your writing</p>
      <blockquote>
        "Meaning is not discovered once; it is constructed through choices that expose our values
        under pressure."
      </blockquote>
    </div>
    <div class="essay-review">
      <p class="essay-heading">SOPHIA Review</p>
      <ul>
        <li>Analysis: Clear thesis, well-scaffolded.</li>
        <li>Critique: Assumptions around agency need refinement.</li>
        <li>Synthesis: Rephrase to align with existentialist view.</li>
      </ul>
      <a class="inline-link" href="/auth">Get Feedback on Your Philosophy Writing →</a>
    </div>
  </section>

  <section class="audience" aria-labelledby="audience-title">
    <h2 id="audience-title">Philosophy In Action</h2>
    <p>
      SOPHIA is used by students, educators, and lifelong learners to explore ethics, logic, and
      meaning. From first essays to advanced reasoning, the platform scales with your progress.
    </p>
  </section>

  <section class="pricing" aria-labelledby="pricing-title">
    <h2 id="pricing-title">Pricing Overview</h2>
    <div class="cards-3 pricing-cards">
      <article class="price-card">
        <h3>Curious Thinker</h3>
        <p class="tier">Free</p>
        <p>5 daily standard inquiries on platform capacity (BYOK optional)</p>
      </article>
      <article class="price-card featured">
        <h3>Dedicated Inquirer</h3>
        <p class="tier">Pro</p>
        <p>10 standard + 3 deep + 1 premium inquiry daily without BYOK</p>
      </article>
      <article class="price-card">
        <h3>Philosopher's Desk</h3>
        <p class="tier">Premium</p>
        <p>20 standard + 3 deep + 1 premium inquiry daily without BYOK</p>
      </article>
    </div>
    <a class="btn secondary" href="/pricing">See Plans</a>
  </section>

  <section class="closing" aria-labelledby="closing-title">
    <p id="closing-title">
      Philosophy is learned through thinking - and thinking through dialogue. SOPHIA supports
      both.
    </p>
    <a class="btn primary" href="/auth">Start Your Journey</a>
  </section>

  <footer class="marketing-footer">Think deeply. Write clearly. Learn continuously.</footer>
</main>

<style>
  .marketing-page {
    min-height: 100vh;
    color: var(--color-text);
  }

  .hero {
    margin-top: 18px;
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 30px;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: rgba(20, 19, 18, 0.88);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.34);
    padding: clamp(22px, 3vw, 42px);
  }

  .founder-strip {
    margin-top: 12px;
    border: 1px solid var(--color-sage-border);
    border-radius: 10px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--color-sage) 10%, transparent);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .founder-strip p {
    margin: 0;
    color: var(--color-text);
    line-height: 1.45;
  }

  .eyebrow {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.68rem;
    color: var(--color-sage);
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2rem, 5.3vw, 3.55rem);
    line-height: 1.12;
    max-width: 18ch;
  }

  .subhead {
    margin: 16px 0 0;
    max-width: 58ch;
    color: var(--color-muted);
    font-size: 1.07rem;
    line-height: 1.6;
  }

  .hero-actions {
    margin-top: 24px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    border-radius: 8px;
    text-decoration: none;
    padding: 0 16px;
    border: 1px solid transparent;
    font-family: var(--font-ui);
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn.primary {
    background: var(--color-sage);
    color: var(--color-bg);
  }

  .btn.secondary {
    background: var(--color-surface-raised);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .microcopy {
    margin: 14px 0 0;
    color: var(--color-dim);
    font-size: 0.88rem;
    line-height: 1.55;
    max-width: 62ch;
  }

  .hero-art {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 260px;
    position: relative;
  }

  .hero-orb {
    position: absolute;
    inset: 18% 14%;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 42%, rgba(163, 179, 142, 0.26), transparent 72%);
    filter: blur(0.5px);
  }

  .panel,
  .journey,
  .essay,
  .audience,
  .pricing,
  .closing {
    margin-top: 28px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: rgba(20, 19, 18, 0.9);
    padding: clamp(18px, 2.5vw, 32px);
  }

  h2 {
    margin: 0 0 16px;
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 3vw, 2rem);
  }

  .cards-3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .info-card,
  .price-card {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface);
    padding: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .glyph {
    margin: 0 0 8px;
    color: var(--color-sage);
    font-family: var(--font-display);
    font-size: 1.08rem;
  }

  .info-card p:last-child,
  .price-card p:last-child {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.58;
  }

  .journey p,
  .audience p {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.7;
    max-width: 78ch;
  }

  .timeline {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .timeline span {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 6px 10px;
    text-align: center;
    font-family: var(--font-ui);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: var(--color-surface-sunken);
  }

  .inline-link {
    margin-top: 14px;
    display: inline-block;
    color: var(--color-sage);
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .inline-link:hover {
    text-decoration: underline;
  }

  .preview-stack {
    display: grid;
    gap: 10px;
  }

  .preview-card {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-sunken);
    padding: 12px 14px;
  }

  .preview-card.analysis {
    border-left: 3px solid var(--color-sage);
  }

  .preview-card.critique {
    border-left: 3px solid var(--color-copper);
  }

  .preview-card.synthesis {
    border-left: 3px solid var(--color-blue);
  }

  .preview-card h3 {
    margin: 0 0 4px;
    font-size: 0.88rem;
    letter-spacing: 0.06em;
    font-family: var(--font-ui);
    text-transform: uppercase;
    color: var(--color-text);
  }

  .preview-card p,
  .section-note {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.6;
  }

  .section-note {
    margin-top: 12px;
  }

  .essay {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .essay-heading {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.68rem;
    color: var(--color-sage);
  }

  blockquote {
    margin: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-sunken);
    padding: 12px;
    color: var(--color-muted);
    line-height: 1.7;
  }

  .essay-review ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-muted);
    line-height: 1.7;
  }

  .pricing-cards .price-card.featured {
    border-color: var(--color-sage);
    background: linear-gradient(180deg, rgba(158, 183, 149, 0.08), rgba(21, 21, 21, 0.94));
  }

  .price-card h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.08rem;
  }

  .tier {
    margin: 4px 0 8px;
    color: var(--color-sage);
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .pricing > .btn {
    margin-top: 14px;
  }

  .closing {
    text-align: center;
  }

  .closing p {
    margin: 0 0 16px;
    color: var(--color-muted);
    font-size: 1.02rem;
    line-height: 1.7;
  }

  .marketing-footer {
    margin-top: 26px;
    text-align: center;
    color: var(--color-dim);
    font-family: var(--font-ui);
    font-size: 0.67rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }

  @media (max-width: 960px) {
    .hero {
      grid-template-columns: 1fr;
    }

    .hero-art {
      min-height: 180px;
    }

    .cards-3 {
      grid-template-columns: 1fr;
    }

    .essay {
      grid-template-columns: 1fr;
    }

    .timeline {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 640px) {
    .timeline {
      grid-template-columns: 1fr;
    }

    .btn {
      width: 100%;
    }
  }
</style>
