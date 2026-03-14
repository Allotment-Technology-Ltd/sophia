<script lang="ts">
  import type { GraphKitEvaluationFinding, GraphKitInspectorPayload } from '$lib/graph-kit/types';
  import CitationChip from '$lib/graph-kit/components/primitives/CitationChip.svelte';
  import EvidenceCard from '$lib/graph-kit/components/primitives/EvidenceCard.svelte';
  import SourceBadge from '$lib/graph-kit/components/primitives/SourceBadge.svelte';
  import ValidationNote from '$lib/graph-kit/components/primitives/ValidationNote.svelte';

  interface Props {
    payload: GraphKitInspectorPayload;
    focusedSection?: 'evidence' | 'provenance' | 'validation' | null;
    onAction?: (actionId: string) => void;
  }

  let { payload, focusedSection = null, onAction }: Props = $props();

  let provenanceSectionEl = $state<HTMLElement | null>(null);
  let evidenceSectionEl = $state<HTMLElement | null>(null);
  let validationSectionEl = $state<HTMLElement | null>(null);

  function toneForFinding(finding: GraphKitEvaluationFinding): 'info' | 'warning' | 'error' {
    if (finding.severity === 'error') return 'error';
    if (finding.severity === 'warning') return 'warning';
    return 'info';
  }

  $effect(() => {
    if (focusedSection === 'provenance') {
      provenanceSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (focusedSection === 'evidence') {
      evidenceSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (focusedSection === 'validation') {
      validationSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
</script>

<aside class="inspector" aria-label="Graph inspector">
  <div class="inspector-header">
    <p class="eyebrow">{payload.target} inspector</p>
    <h2>{payload.title}</h2>
    {#if payload.subtitle}
      <p class="subtitle">{payload.subtitle}</p>
    {/if}
    {#if payload.badges && payload.badges.length > 0}
      <div class="badge-row">
        {#each payload.badges as badge}
          <span class="badge">{badge}</span>
        {/each}
      </div>
    {/if}
    {#if payload.summary}
      <p class="summary">{payload.summary}</p>
    {/if}
    <div class="meta-row">
      {#if typeof payload.confidence === 'number'}
        <span class="confidence-chip">confidence {Math.round(payload.confidence * 100)}%</span>
      {/if}
      {#if payload.sourceBadges}
        {#each payload.sourceBadges as source}
          <SourceBadge label={source} />
        {/each}
      {/if}
    </div>
  </div>

  {#if payload.actions && payload.actions.length > 0}
    <div class="action-row">
      {#each payload.actions as action}
        <button type="button" class="action-btn" disabled={action.disabled} onclick={() => onAction?.(action.id)}>
          {action.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="section-stack">
    {#if payload.provenance && payload.provenance.length > 0}
      <section class="section-card" bind:this={provenanceSectionEl} class:is-focused={focusedSection === 'provenance'}>
        <h3>Provenance</h3>
        <div class="chip-row">
          {#each payload.provenance as item}
            <CitationChip {item} />
          {/each}
        </div>
      </section>
    {/if}

    {#if payload.evidence && payload.evidence.length > 0}
      <section class="section-card" bind:this={evidenceSectionEl} class:is-focused={focusedSection === 'evidence'}>
        <h3>Evidence</h3>
        <div class="evidence-stack">
          {#each payload.evidence as item}
            <EvidenceCard item={item} highlighted={focusedSection === 'evidence'} />
          {/each}
        </div>
      </section>
    {/if}

    {#if payload.supportRelations && payload.supportRelations.length > 0}
      <section class="section-card relation-card">
        <h3>Support Relations</h3>
        <dl>
          {#each payload.supportRelations as relation}
            <div class="row">
              <dt>{relation.title}</dt>
              <dd>
                supports
                {#if typeof relation.confidence === 'number'}
                  · {Math.round(relation.confidence * 100)}%
                {/if}
                {#if relation.rationale}
                  · {relation.rationale}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}

    {#if payload.contradictionRelations && payload.contradictionRelations.length > 0}
      <section class="section-card relation-card contradiction-card">
        <h3>Contradiction Relations</h3>
        <dl>
          {#each payload.contradictionRelations as relation}
            <div class="row">
              <dt>{relation.title}</dt>
              <dd>
                contradicts
                {#if typeof relation.confidence === 'number'}
                  · {Math.round(relation.confidence * 100)}%
                {/if}
                {#if relation.rationale}
                  · {relation.rationale}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}

    {#each payload.sections as section}
      <section class="section-card">
        <h3>{section.title}</h3>
        <dl>
          {#each section.rows as row}
            <div class="row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}

    {#if payload.validationNotes && payload.validationNotes.length > 0}
      <section
        class="section-card"
        bind:this={validationSectionEl}
        class:is-focused={focusedSection === 'validation'}
      >
        <h3>Validation Notes</h3>
        <div class="validation-stack">
          {#each payload.validationNotes as note}
            <ValidationNote {note} tone="warning" />
          {/each}
        </div>
      </section>
    {/if}

    {#if payload.evaluationFindings && payload.evaluationFindings.length > 0}
      <section class="section-card">
        <h3>Graph Evaluation Findings</h3>
        <div class="validation-stack">
          {#each payload.evaluationFindings as finding}
            <ValidationNote
              note={`${finding.title}: ${finding.summary}`}
              tone={toneForFinding(finding)}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if payload.todo && payload.todo.length > 0}
      <section class="section-card todo-card">
        <h3>Next extraction seams</h3>
        <ul>
          {#each payload.todo as item}
            <li>{item}</li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</aside>

<style>
  .inspector {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 12px;
    padding: 16px;
    border-left: 1px solid var(--color-border);
    background:
      radial-gradient(circle at top, rgba(127, 163, 131, 0.08), transparent 42%),
      color-mix(in srgb, var(--color-surface) 94%, var(--color-bg));
    overflow: auto;
  }

  .inspector-header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1.15;
  }

  .eyebrow,
  .subtitle,
  dt,
  .badge,
  .action-btn,
  li {
    font-family: var(--font-ui);
  }

  .eyebrow {
    margin: 0 0 8px;
    color: var(--color-amber);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .subtitle,
  .summary {
    margin: 8px 0 0;
    color: var(--color-muted);
  }

  .badge-row,
  .action-row,
  .meta-row,
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .meta-row {
    margin-top: 10px;
  }

  .badge {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 3px 8px;
    font-size: var(--text-meta);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
    text-transform: lowercase;
  }

  .action-btn {
    border: 1px solid var(--color-sage-border);
    background: var(--color-sage-bg);
    color: var(--color-text);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    font-size: var(--text-ui);
    cursor: pointer;
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .section-stack {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .section-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
    padding: 12px;
  }

  .section-card.is-focused {
    border-color: var(--color-blue-border);
    box-shadow: 0 0 0 1px var(--color-blue-border);
  }

  .section-card h3 {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  dl {
    margin: 0;
    display: grid;
    gap: 8px;
  }

  .row {
    display: grid;
    gap: 4px;
  }

  .relation-card dt {
    color: var(--color-text);
    font-size: 0.9rem;
  }

  .contradiction-card {
    border-color: var(--color-coral-border);
  }

  dt {
    color: var(--color-dim);
    font-size: var(--text-meta);
    text-transform: lowercase;
  }

  dd {
    margin: 0;
    color: var(--color-text);
    font-size: 0.95rem;
    line-height: 1.45;
  }

  .confidence-chip {
    border: 1px solid var(--color-blue-border);
    border-radius: 999px;
    padding: 3px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-blue);
  }

  .todo-card {
    border-color: var(--color-amber-border);
  }

  .evidence-stack,
  .validation-stack {
    display: grid;
    gap: 10px;
  }

  ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-muted);
    display: grid;
    gap: 8px;
  }

  @media (max-width: 960px) {
    .inspector {
      border-left: none;
      border-top: 1px solid var(--color-border);
    }
  }
</style>
