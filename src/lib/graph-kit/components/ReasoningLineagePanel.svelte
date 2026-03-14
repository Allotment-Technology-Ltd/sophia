<script lang="ts">
  import type { ReasoningLineageReport } from '@restormel/contracts/reasoning-lineage';

  interface Props {
    report: ReasoningLineageReport;
    markdown: string;
    title?: string;
  }

  let { report, markdown, title = 'Decision-lineage report' }: Props = $props();
  let copyStatus = $state<string | null>(null);

  async function copyMarkdown(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      copyStatus = 'Clipboard copy is unavailable in this browser.';
      return;
    }

    await navigator.clipboard.writeText(markdown);
    copyStatus = 'Markdown copied to clipboard.';
  }

  async function copyJson(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      copyStatus = 'Clipboard copy is unavailable in this browser.';
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    copyStatus = 'JSON copied to clipboard.';
  }
</script>

<section class="lineage-panel" aria-label="Decision-lineage report">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Audit-ready surface</p>
      <h2>{title}</h2>
      <p class="intro">
        Lightweight justification artefact generated from the canonical reasoning-object model. This is intended for export, review, and future governance integrations, not workflow management.
      </p>
    </div>

    <div class="actions">
      <button type="button" class="action-btn" onclick={copyMarkdown}>Copy Markdown</button>
      <button type="button" class="action-btn" onclick={copyJson}>Copy JSON</button>
    </div>
  </div>

  {#if copyStatus}
    <p class="copy-status">{copyStatus}</p>
  {/if}

  <div class="summary-grid">
    <article class="summary-card">
      <h3>Reasoning summary</h3>
      <p>{report.reasoningSummary.topLine}</p>
      <dl>
        <div class="row"><dt>nodes</dt><dd>{report.reasoningSummary.nodeCount}</dd></div>
        <div class="row"><dt>edges</dt><dd>{report.reasoningSummary.edgeCount}</dd></div>
        <div class="row"><dt>claim-like objects</dt><dd>{report.reasoningSummary.claimCount}</dd></div>
        <div class="row"><dt>evidence-backed</dt><dd>{report.reasoningSummary.evidenceBackedClaimCount}</dd></div>
        <div class="row"><dt>evaluation findings</dt><dd>{report.reasoningSummary.evaluationFindingCount}</dd></div>
      </dl>
    </article>

    <article class="summary-card">
      <h3>Contradictions</h3>
      {#if report.contradictions.length === 0}
        <p>No contradiction items were identified in the current snapshot.</p>
      {:else}
        <div class="list-stack">
          {#each report.contradictions.slice(0, 4) as item}
            <div class="list-item contradiction">
              <strong>{item.title}</strong>
              <p>{item.note}</p>
              <span>{item.status} · {item.contradictionEdgeCount} contradiction edges</span>
            </div>
          {/each}
        </div>
      {/if}
    </article>

    <article class="summary-card">
      <h3>Provenance bundle</h3>
      <dl>
        <div class="row"><dt>items</dt><dd>{report.provenanceBundle.totalItems}</dd></div>
        <div class="row"><dt>unique source refs</dt><dd>{report.provenanceBundle.uniqueSourceRefs}</dd></div>
        <div class="row"><dt>missing provenance</dt><dd>{report.provenanceBundle.missingProvenanceCount}</dd></div>
      </dl>
      {#if report.provenanceBundle.items.length > 0}
        <div class="list-stack compact">
          {#each report.provenanceBundle.items.slice(0, 3) as item}
            <div class="list-item">
              <strong>{item.label}</strong>
              <p>{item.value}</p>
            </div>
          {/each}
        </div>
      {/if}
    </article>
  </div>

  <div class="content-grid">
    <section class="detail-card">
      <h3>Evidence-backed justifications</h3>
      {#if report.justifications.length === 0}
        <p class="empty-copy">No justification items were available.</p>
      {:else}
        <div class="list-stack">
          {#each report.justifications as item}
            <article class="list-item">
              <strong>{item.title}</strong>
              <p>
                {item.kind}
                {#if item.phase}
                  · {item.phase}
                {/if}
                {#if typeof item.confidence === 'number'}
                  · {Math.round(item.confidence * 100)}%
                {/if}
              </p>
              <p>
                evidence {item.evidenceCount} · provenance {item.provenanceCount} · support {item.supportEdgeCount} · contradiction {item.contradictionEdgeCount}
              </p>
              {#if item.primaryEvidence}
                <p class="secondary">primary evidence: {item.primaryEvidence}</p>
              {/if}
              {#if item.rationale}
                <p class="secondary">rationale: {item.rationale}</p>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="detail-card">
      <h3>Run comparison summary</h3>
      {#if !report.compareSummary}
        <p class="empty-copy">No baseline diff was attached to this lineage artefact.</p>
      {:else}
        <p>{report.compareSummary.summary}</p>
        <dl>
          <div class="row"><dt>added claims</dt><dd>{report.compareSummary.addedClaims}</dd></div>
          <div class="row"><dt>removed claims</dt><dd>{report.compareSummary.removedClaims}</dd></div>
          <div class="row"><dt>evidence deltas</dt><dd>{report.compareSummary.evidenceDeltaCount}</dd></div>
          <div class="row"><dt>provenance deltas</dt><dd>{report.compareSummary.provenanceDeltaCount}</dd></div>
          <div class="row"><dt>contradiction changes</dt><dd>{report.compareSummary.contradictionChangeCount}</dd></div>
          <div class="row"><dt>support changes</dt><dd>{report.compareSummary.supportStrengthChangeCount}</dd></div>
          <div class="row"><dt>output changes</dt><dd>{report.compareSummary.outputChangeCount}</dd></div>
        </dl>
      {/if}
    </section>

    <section class="detail-card markdown-card">
      <h3>Export preview</h3>
      <pre>{markdown}</pre>
    </section>
  </div>
</section>

<style>
  .lineage-panel {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background:
      linear-gradient(180deg, rgba(111, 163, 212, 0.05), transparent),
      color-mix(in srgb, var(--color-surface) 94%, var(--color-bg));
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .eyebrow,
  .action-btn,
  dt {
    font-family: var(--font-ui);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--color-purple);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  h2,
  h3 {
    margin: 0;
    font-family: var(--font-display);
  }

  .intro,
  .copy-status,
  .empty-copy,
  .secondary,
  .list-item span,
  .list-item p {
    margin: 8px 0 0;
    color: var(--color-muted);
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .action-btn {
    min-height: 36px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
    color: var(--color-text);
    padding: 0 10px;
    cursor: pointer;
  }

  .summary-grid,
  .content-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .summary-card,
  .detail-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
    padding: 12px;
  }

  dl {
    margin: 10px 0 0;
    display: grid;
    gap: 8px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  dt {
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: var(--text-meta);
  }

  dd {
    margin: 0;
  }

  .list-stack {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }

  .compact .list-item p {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .list-item {
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  }

  .list-item.contradiction {
    border-color: var(--color-coral-border);
    background: var(--color-coral-bg);
  }

  .markdown-card pre {
    margin: 10px 0 0;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    font: 0.85rem/1.45 var(--font-mono);
    color: var(--color-text);
  }

  @media (max-width: 1100px) {
    .summary-grid,
    .content-grid {
      grid-template-columns: 1fr;
    }

    .panel-header {
      flex-direction: column;
    }
  }
</style>
