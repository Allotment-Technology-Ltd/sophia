<script lang="ts">
  /**
   * Narrow first-run path: few choices, links into existing tools.
   * Advanced surfaces stay on other admin routes.
   */
</script>

<svelte:head>
  <title>Quick start — Admin</title>
</svelte:head>

<div class="admin-quick min-h-screen text-sophia-dark-text">
  <div class="mx-auto w-full max-w-[48rem] px-6 py-10 sm:px-10">
    <header class="rounded-2xl border border-sophia-dark-border/80 bg-sophia-dark-surface/95 p-8">
      <p class="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-sophia-dark-muted">Admin · Start here</p>
      <h1 class="mt-2 font-serif text-3xl leading-tight text-sophia-dark-text md:text-[2.1rem]">
        Get running in about 10 minutes
      </h1>
      <p class="mt-3 text-base leading-7 text-sophia-dark-muted">
        Pick one path below. Defaults are designed to work without tuning every stage. Use
        <strong class="font-medium text-sophia-dark-text">Advanced</strong> links only when you need them.
      </p>
      <p class="mt-4 text-sm leading-6 text-sophia-dark-muted">
        <a
          href="/admin?skip_quick_start=1"
          class="font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-dim underline decoration-sophia-dark-border underline-offset-4 hover:text-sophia-dark-text hover:decoration-sophia-dark-sage"
          >Skip quick start — open full ingestion setup</a
        >
      </p>
    </header>

    <section class="mt-8 space-y-6" aria-labelledby="qs-choose">
      <h2 id="qs-choose" class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
        What are you doing first?
      </h2>

      <article
        class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface/90 p-6 md:p-8"
      >
        <h3 class="font-serif text-xl text-sophia-dark-text">Ingest a source into the graph</h3>
        <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
          URL or file → quick model defaults → hand off to operations to queue the run. Skip routing math until
          something works once.
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <a
            href="/admin?from_quick_start=1"
            class="inline-flex items-center justify-center rounded-lg border border-sophia-dark-sage/50 bg-sophia-dark-sage/15 px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-text hover:bg-sophia-dark-sage/25"
            >Start ingestion wizard</a
          >
          <a
            href="/admin/operations?from_quick_start=1"
            class="inline-flex items-center justify-center rounded-lg border border-sophia-dark-border px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised hover:text-sophia-dark-text"
            >Open operations workbench</a
          >
        </div>
      </article>

      <article
        class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface/90 p-6 md:p-8"
      >
        <h3 class="font-serif text-xl text-sophia-dark-text">Review or fix ingested items</h3>
        <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
          After a run exists, triage the queue. No routing setup required.
        </p>
        <div class="mt-5">
          <a
            href="/admin/review?from_quick_start=1"
            class="inline-flex items-center justify-center rounded-lg border border-sophia-dark-border px-5 py-3 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
            >Open review queue</a
          >
        </div>
      </article>
    </section>

    <section class="mt-10 rounded-2xl border border-dashed border-sophia-dark-border/90 bg-sophia-dark-bg/40 p-6" aria-labelledby="qs-advanced">
      <h2 id="qs-advanced" class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">
        Advanced (same day, optional)
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-sophia-dark-muted">
        <li>
          <a href="/admin/ingestion-routing" class="text-sophia-dark-text underline decoration-sophia-dark-border underline-offset-4 hover:decoration-sophia-dark-sage"
            >Ingestion routing</a
          >
          — stage routes, provider health, simulations.
        </li>
        <li>
          <a href="/admin/ingest" class="text-sophia-dark-text underline decoration-sophia-dark-border underline-offset-4 hover:decoration-sophia-dark-sage"
            >Legacy ingest runner</a
          >
          — alternative pipeline UI.
        </li>
        <li>
          Operator spec (in repo):
          <code class="rounded bg-sophia-dark-surface px-1.5 py-0.5 font-mono text-xs text-sophia-dark-text"
            >docs/admin/dashboard-ten-minute-experience.md</code
          >.
        </li>
      </ul>
    </section>

    <p class="mt-10 text-center font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
      <a href="/admin?from_quick_start=1" class="text-sophia-dark-muted hover:text-sophia-dark-text"
        >← Ingestion home</a
      >
    </p>
  </div>
</div>
