<script lang="ts">
  const destinations = [
    {
      href: '/admin/ingest',
      title: 'Expand',
      description:
        'Ingestion orchestration: source setup, pre-scan, Restormel pipeline and model routing, cost review, run and SurrealDB sync. This is the primary operator workspace.',
      emphasis: true
    },
    {
      href: '/admin/ingest/runs',
      title: 'Ingestion runs',
      description:
        'List runs on this server, reopen a run to resume monitoring, logs, sync, and resume actions. Runs are in-memory until the process restarts.',
      emphasis: false
    },
    {
      href: '/admin/ingest/batch',
      title: 'Batch ingestions',
      description:
        'Tradition-based STOA batch wizard: scan canonical open-license repositories, choose 5–30 sources, then queue/review/run from one flow.',
      emphasis: false
    },
    {
      href: '/admin/ingest/jobs',
      title: 'Durable ingestion jobs',
      description:
        'Neon-backed multi-URL jobs with full Surreal store, live status, and append-only timeline. Use with the ingestion job poller on GCP for SEP-scale batches.',
      emphasis: false
    },
    {
      href: '/admin/operator-byok',
      title: 'Operator BYOK',
      description:
        'Govern operational provider keys on the OWNER_UIDS target: status, save, validate, and revoke. Used as fallback when tenant keys are empty (see effective-key resolver).',
      emphasis: false
    },
    {
      href: '/admin/model-availability',
      title: 'Model availability',
      description:
        'Choose which Restormel catalog models are available for ingestion (operations) versus user inquiries; syncs the project model index on save. Embeddings stay operations-only.',
      emphasis: false
    },
    {
      href: '/admin/thinker-links',
      title: 'Thinker link review',
      description:
        'Review unresolved author names from thinker import, resolve to Wikidata QIDs, and backfill thinker→authored→source links via an operator queue.',
      emphasis: false
    },
    {
      href: '/admin/users',
      title: 'User management',
      description:
        'List registered users and set each account to owner or user. At least one owner must remain. Emails in OWNER_EMAILS are re-promoted to owner on their next API-authenticated request.',
      emphasis: false
    }
  ] as const;
</script>

<svelte:head>
  <title>Admin — SOPHIA</title>
</svelte:head>

<main class="expand-page">
  <header class="expand-hero">
    <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
    <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Operator hub</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
      Entry points for administration and ingestion control. Use Expand for the full workflow; use Ingestion runs when you need to return to an active or recent job; use Operator BYOK to manage fallback keys on the owner UID bucket.
    </p>
  </header>

  <section class="hub-section" aria-labelledby="hub-primary-heading">
    <h2 id="hub-primary-heading" class="sr-only">Primary tools</h2>
    <ul class="hub-card-grid">
      {#each destinations as item, i}
        <li>
          <a href={item.href} class="hub-card" class:hub-card--primary={item.emphasis ?? false}>
            <div class="hub-card-inner">
              <span class="hub-card-index font-mono text-[0.65rem] uppercase tracking-[0.14em] text-sophia-dark-dim"
                >{String(i + 1).padStart(2, '0')}</span
              >
              <h3 class="hub-card-title font-serif text-xl text-sophia-dark-text">{item.title}</h3>
              <p class="hub-card-desc mt-2 text-sm leading-relaxed text-sophia-dark-muted">{item.description}</p>
              <span class="hub-card-cta mt-4 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-sage">
                Open <span aria-hidden="true">→</span>
              </span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  </section>
</main>

<style>
  .expand-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1240px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .expand-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.2), rgba(44, 96, 142, 0.14));
    border-radius: 12px;
    padding: 20px;
  }
  .hub-section {
    margin-top: 28px;
  }
  .hub-card-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 16px;
  }
  @media (min-width: 768px) {
    .hub-card-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1100px) {
    .hub-card-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .hub-card {
    display: block;
    height: 100%;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      transform 0.2s ease;
  }
  .hub-card:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
    transform: translateY(-2px);
  }
  .hub-card:focus-visible {
    outline: 2px solid var(--color-blue);
    outline-offset: 3px;
  }
  .hub-card--primary {
    border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
    background: linear-gradient(160deg, color-mix(in srgb, var(--color-sage) 8%, var(--color-surface)) 0%, var(--color-surface) 55%);
  }
  .hub-card-inner {
    padding: 22px 22px 20px;
    min-height: 200px;
    display: flex;
    flex-direction: column;
  }
  .hub-card-title {
    margin-top: 8px;
  }
  .hub-card-cta {
    margin-top: auto;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
