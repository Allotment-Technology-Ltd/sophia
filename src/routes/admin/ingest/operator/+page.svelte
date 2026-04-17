<script lang="ts">
  const cards = [
    {
      href: '/admin/ingest/operator/routing',
      title: 'Routing & models',
      body: 'Per-phase Restormel routes, step chains, catalog pricing, pin overrides, and bootstrap/MCP pointers — before you run.'
    },
    {
      href: '/admin/ingest/jobs',
      title: 'Durable jobs',
      body: 'Primary batch surface: paste URLs, SEP presets, worker defaults, DLQ, merge into a running job, advance queues.'
    },
    {
      href: '/admin/ingest/operator/bulk-extract',
      title: 'Bulk extract → promote',
      body: 'Two-stage path: Fireworks checklist → extraction-only job → teardown → promote each URL when ready.'
    },
    {
      href: '/admin/ingest/operator/from-neon',
      title: 'Continue from Neon',
      body: 'Runs in awaiting promote: enqueue the pipeline tail without re-running extraction.'
    },
    {
      href: '/admin/ingest/operator/activity',
      title: 'Activity',
      body: 'Neon staging, in-memory runs, job list, and recent Firestore report snapshots — one refresh.'
    }
  ] as const;
</script>

<svelte:head>
  <title>Operator — Ingestion</title>
</svelte:head>

<main class="op-main">
  <header class="op-hero">
    <p class="op-kicker">Admin</p>
    <h1 class="op-h1">Ingestion operator hub</h1>
    <p class="op-sub">
      Start with <strong>Durable jobs</strong> for batch work. Use the staged flows when extraction and the pipeline tail are separate steps. <strong>Activity</strong> replaces the old “all runs” page (in-memory + Neon + Firestore reports). Rare full routing UI:
      <a href="/admin/ingest/legacy-wizard">Legacy wizard</a>.
    </p>
  </header>

  <ul class="op-grid">
    {#each cards as c (c.href)}
      <li>
        <a class="op-card" href={c.href}>
          <h2 class="op-card-title">{c.title}</h2>
          <p class="op-card-body">{c.body}</p>
        </a>
      </li>
    {/each}
  </ul>
</main>

<style>
  .op-main {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  .op-hero {
    margin-bottom: 24px;
  }
  .op-kicker {
    margin: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-text);
    opacity: 0.75;
  }
  .op-h1 {
    margin: 8px 0 10px;
    font-family: var(--font-serif);
    font-size: 1.75rem;
    color: var(--color-text);
  }
  .op-sub {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--color-text);
    max-width: 52rem;
  }
  .op-sub a {
    color: var(--color-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .op-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 14px;
    grid-template-columns: 1fr;
  }
  @media (min-width: 640px) {
    .op-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  .op-card {
    display: block;
    height: 100%;
    padding: 18px 18px 16px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
    background: var(--color-surface);
    color: inherit;
    text-decoration: none;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease;
  }
  .op-card:hover {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }
  .op-card-title {
    margin: 0 0 8px;
    font-size: 1.05rem;
    font-family: var(--font-serif);
    color: var(--color-text);
  }
  .op-card-body {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--color-text);
    opacity: 0.92;
  }
</style>
