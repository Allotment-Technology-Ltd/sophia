<script lang="ts">
  import {
    buildPipelineStageRows,
    type PipelineStageRow
  } from '$lib/admin/ingest/pipelinePresentModel';
  import { extractRecentBracketTaggedLines, type BracketLogEntry } from '$lib/admin/ingest/bracketLogTimeline';

  export let stages: unknown;
  export let currentStageKey: string | null | undefined = null;
  export let currentAction: string | null | undefined = null;
  export let lastFailureStageKey: string | null | undefined = null;
  export let logLines: string[] = [];
  /** Max tagged lines to show under “Activity”. */
  export let maxBracketLines = 100;
  /** Tighter layout for embedded panels (e.g. Monitoring run inspector). */
  export let compact = false;

  let stageRows: PipelineStageRow[] = [];
  let bracketLines: BracketLogEntry[] = [];

  $: stageRows = buildPipelineStageRows(stages, currentStageKey);
  $: bracketCap = compact ? Math.min(maxBracketLines, 36) : maxBracketLines;
  $: bracketLines = extractRecentBracketTaggedLines(logLines ?? [], bracketCap);

  function stageDotClass(status: string): string {
    const s = (status ?? 'idle').toLowerCase();
    if (s === 'done') return 'ppt-dot ppt-dot--done';
    if (s === 'running') return 'ppt-dot ppt-dot--run';
    if (s === 'error') return 'ppt-dot ppt-dot--err';
    if (s === 'skipped') return 'ppt-dot ppt-dot--skip';
    return 'ppt-dot ppt-dot--idle';
  }

  function tagPillClass(tag: string): string {
    const t = tag.toUpperCase();
    if (t === 'WARN' || t.startsWith('WARN')) return 'ppt-tag ppt-tag--warn';
    if (t.includes('ERROR') || t === 'FATAL' || t === 'CANCEL' || t === 'TERMINAL') return 'ppt-tag ppt-tag--err';
    if (t === 'FETCH' || t === 'QUEUE' || t === 'PROMOTE') return 'ppt-tag ppt-tag--accent';
    return 'ppt-tag';
  }
</script>

<div class="ppt-root" class:ppt-root--compact={compact}>
  <section class="ppt-section" aria-labelledby="ppt-pipeline-h">
    <h3 id="ppt-pipeline-h" class="ppt-h" class:ppt-h--compact={compact}>Pipeline</h3>
    {#if !compact}
      <p class="ppt-lead">Stage state from the ingest worker (same source as the run console tiles).</p>
    {/if}
    {#if currentAction}
      <p class="ppt-action">
        <span class="ppt-action__k">Now</span>
        {currentAction}
      </p>
    {/if}
    {#if lastFailureStageKey}
      <p class="ppt-fail">
        Last failure stage: <code class="ppt-code">{lastFailureStageKey}</code>
      </p>
    {/if}

    {#if stageRows.length === 0}
      <p class="ppt-muted">No stage data.</p>
    {:else}
      <ol class="ppt-stages" aria-label="Pipeline stages">
        {#each stageRows as row, i (row.key)}
          <li class="ppt-stage" class:ppt-stage--current={row.isCurrent}>
            <div class="ppt-stage__rail" aria-hidden="true">
              <span class={stageDotClass(row.status)}></span>
              {#if i < stageRows.length - 1}
                <span class="ppt-stage__stem"></span>
              {/if}
            </div>
            <div class="ppt-stage__body">
              <div class="ppt-stage__top">
                <span class="ppt-stage__label">{row.label}</span>
                <span class="ppt-stage__status">{row.status}</span>
              </div>
              {#if row.summary}
                <p class="ppt-stage__sum">{row.summary}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="ppt-section" aria-labelledby="ppt-act-h">
    {#if compact}
      <details class="ppt-details" open={false}>
        <summary id="ppt-act-h" class="ppt-details__summary">
          Tagged lines ({bracketLines.length})
        </summary>
        {#if bracketLines.length === 0}
          <p class="ppt-muted ppt-details__body">No bracket-tagged lines in the buffer.</p>
        {:else}
          <ul class="ppt-feed ppt-feed--compact" aria-label="Bracket-tagged log lines">
            {#each bracketLines as e, i (i)}
              <li class="ppt-feed__row">
                <span class="ppt-feed__rule" aria-hidden="true"></span>
                <div class="ppt-feed__main">
                  <span class={tagPillClass(e.tag)}>{e.tag}</span>
                  {#if e.body}
                    <span class="ppt-feed__body">{e.body}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {:else}
      <h3 id="ppt-act-h" class="ppt-h">Tagged activity</h3>
      <p class="ppt-lead">
        Recent lines with a <code class="ppt-code">[TAG]</code> prefix (orchestrator + worker). Full output stays in the raw log column.
      </p>
      {#if bracketLines.length === 0}
        <p class="ppt-muted">No bracket-tagged lines in the current buffer.</p>
      {:else}
        <ul class="ppt-feed" aria-label="Bracket-tagged log lines">
          {#each bracketLines as e, i (i)}
            <li class="ppt-feed__row">
              <span class="ppt-feed__rule" aria-hidden="true"></span>
              <div class="ppt-feed__main">
                <span class={tagPillClass(e.tag)}>{e.tag}</span>
                {#if e.body}
                  <span class="ppt-feed__body">{e.body}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
</div>

<style>
  .ppt-root {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }
  .ppt-root--compact {
    gap: 0.65rem;
  }
  .ppt-h--compact {
    font-size: 0.82rem;
    margin-bottom: 0.2rem;
  }
  .ppt-details {
    margin: 0;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    background: color-mix(in srgb, var(--color-surface) 96%, black 4%);
    padding: 0 10px 8px;
  }
  .ppt-details__summary {
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 8px 0;
    list-style: none;
  }
  .ppt-details__summary::-webkit-details-marker {
    display: none;
  }
  .ppt-details__body {
    margin: 0 0 8px;
  }
  .ppt-feed--compact {
    max-height: 11rem;
    overflow-y: auto;
    margin-left: 4px;
  }
  .ppt-section {
    margin: 0;
  }
  .ppt-h {
    margin: 0 0 0.35rem;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: var(--font-serif, ui-serif, Georgia, serif);
  }
  .ppt-lead {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    opacity: 0.85;
    line-height: 1.45;
    max-width: 40rem;
  }
  .ppt-muted {
    margin: 0;
    font-size: 0.82rem;
    opacity: 0.8;
  }
  .ppt-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78em;
  }
  .ppt-action {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-blue) 35%, var(--color-border));
    background: color-mix(in srgb, var(--color-blue) 8%, var(--color-surface));
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .ppt-action__k {
    display: block;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
    margin-bottom: 0.2rem;
  }
  .ppt-fail {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    color: #f87171;
  }

  .ppt-stages {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .ppt-stage {
    display: flex;
    gap: 0.65rem;
    align-items: stretch;
    margin: 0;
    padding: 0;
  }
  .ppt-stage--current .ppt-stage__body {
    border-color: color-mix(in srgb, var(--color-blue) 40%, var(--color-border));
    background: color-mix(in srgb, var(--color-blue) 6%, var(--color-surface));
  }
  .ppt-stage__rail {
    position: relative;
    width: 18px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 4px;
  }
  .ppt-dot {
    width: 11px;
    height: 11px;
    border-radius: 999px;
    border: 2px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
    z-index: 1;
  }
  .ppt-dot--idle {
    opacity: 0.65;
  }
  .ppt-dot--run {
    border-color: color-mix(in srgb, #3b82f6 55%, var(--color-border));
    background: color-mix(in srgb, #3b82f6 35%, var(--color-surface));
    box-shadow: 0 0 0 3px color-mix(in srgb, #3b82f6 18%, transparent);
  }
  .ppt-dot--done {
    border-color: color-mix(in srgb, var(--color-sage) 50%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 28%, var(--color-surface));
  }
  .ppt-dot--err {
    border-color: color-mix(in srgb, #f87171 55%, var(--color-border));
    background: color-mix(in srgb, #ef4444 22%, var(--color-surface));
  }
  .ppt-dot--skip {
    opacity: 0.35;
  }
  .ppt-stage__stem {
    flex: 1;
    width: 2px;
    margin-top: 2px;
    min-height: 12px;
    background: color-mix(in srgb, var(--color-border) 88%, transparent);
    border-radius: 1px;
  }
  .ppt-stage__body {
    flex: 1;
    min-width: 0;
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
  }
  .ppt-stage__top {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
    justify-content: space-between;
  }
  .ppt-stage__label {
    font-size: 0.82rem;
    font-weight: 600;
  }
  .ppt-stage__status {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.85;
  }
  .ppt-stage__sum {
    margin: 0.35rem 0 0;
    font-size: 0.7rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    opacity: 0.88;
    line-height: 1.45;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
    max-height: 6rem;
    overflow-y: auto;
  }
  .ppt-root--compact .ppt-stage__body {
    padding: 6px 8px;
    margin-bottom: 6px;
  }
  .ppt-root--compact .ppt-stage__sum {
    max-height: 3.5rem;
    font-size: 0.65rem;
  }
  .ppt-root--compact .ppt-action {
    margin-bottom: 0.45rem;
    padding: 0.4rem 0.5rem;
    font-size: 0.78rem;
  }
  .ppt-root--compact .ppt-fail {
    margin-bottom: 0.45rem;
    font-size: 0.75rem;
  }

  .ppt-feed {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: 2px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    margin-left: 6px;
  }
  .ppt-feed__row {
    position: relative;
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 6px 0 6px 12px;
    margin: 0;
  }
  .ppt-feed__rule {
    position: absolute;
    left: -8px;
    top: 12px;
    width: 8px;
    height: 2px;
    background: color-mix(in srgb, var(--color-border) 88%, transparent);
    border-radius: 1px;
  }
  .ppt-feed__main {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.5rem;
    align-items: baseline;
    min-width: 0;
    flex: 1;
  }
  .ppt-tag {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    background: color-mix(in srgb, var(--color-surface) 90%, black 10%);
    flex-shrink: 0;
  }
  .ppt-tag--accent {
    border-color: color-mix(in srgb, var(--color-blue) 40%, var(--color-border));
  }
  .ppt-tag--warn {
    border-color: color-mix(in srgb, #eab308 45%, var(--color-border));
    background: color-mix(in srgb, #eab308 10%, var(--color-surface));
  }
  .ppt-tag--err {
    border-color: color-mix(in srgb, #f87171 45%, var(--color-border));
    background: color-mix(in srgb, #ef4444 10%, var(--color-surface));
  }
  .ppt-feed__body {
    font-size: 0.75rem;
    line-height: 1.35;
    opacity: 0.9;
    word-break: break-word;
  }
</style>
