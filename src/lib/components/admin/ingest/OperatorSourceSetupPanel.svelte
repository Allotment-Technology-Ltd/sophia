<script lang="ts">
  /** Shared intro for operator pipelines: where to pick sources and avoid duplicates. */
</script>

<section class="op-panel" aria-labelledby="op-src-setup-h">
  <h2 id="op-src-setup-h" class="op-panel-title">Sources</h2>
  <p class="op-panel-lead">
    Paste canonical URLs (one per line), or use
    <a class="op-link" href="/admin/ingest/jobs">Durable ingestion jobs</a>
    for SEP topic presets, trimming, and “exclude already ingested”. To attach to an in-memory worker by run id (logs, cancel,
    resume), use the
    <a class="op-link" href="/admin/ingest/run-console">live run console</a>.
  </p>
  <slot />
</section>

<style>
  .op-panel {
    border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
    border-radius: 10px;
    padding: 16px 18px;
    background: color-mix(in srgb, var(--color-surface) 96%, var(--color-border));
  }
  .op-panel-title {
    margin: 0 0 8px;
    font-size: 0.95rem;
    font-family: var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
  }
  .op-panel-lead {
    margin: 0 0 12px;
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--color-text);
  }
  .op-link {
    color: var(--color-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .op-link:hover {
    color: color-mix(in srgb, var(--color-blue) 85%, var(--color-text));
  }
</style>
