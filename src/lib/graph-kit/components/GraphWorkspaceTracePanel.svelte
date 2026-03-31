<script lang="ts">
  import type {
    GraphKitTraceEvent,
    GraphKitTracePlaybackDescriptor
  } from '$lib/graph-kit/types';

  interface Props {
    events: GraphKitTraceEvent[];
    selectedEventId?: string | null;
    playback: GraphKitTracePlaybackDescriptor;
    onSelectEvent?: (eventId: string) => void;
    onStepEvent?: (direction: -1 | 1) => void;
  }

  let {
    events,
    selectedEventId = null,
    playback,
    onSelectEvent,
    onStepEvent
  }: Props = $props();

  const selectedIndex = $derived(
    selectedEventId ? events.findIndex((event) => event.id === selectedEventId) : -1
  );

  function statusLabel(status: GraphKitTraceEvent['status']): string {
    switch (status) {
      case 'warning':
        return 'warning';
      case 'active':
        return 'active';
      case 'todo':
        return 'todo';
      default:
        return 'complete';
    }
  }

  function sourceLabel(source: GraphKitTraceEvent['source']): string {
    switch (source) {
      case 'sophia-stream':
        return 'live run';
      case 'snapshot-meta':
        return 'snapshot meta';
      case 'graph-derived':
        return 'graph derived';
      default:
        return 'placeholder';
    }
  }
</script>

<section class="trace-panel" aria-label="Trace timeline">
  <div class="trace-header">
    <div>
      <p class="eyebrow">Trace Timeline</p>
      <h2>Reasoning and retrieval events</h2>
      <p class="trace-intro">
        Real SOPHIA snapshot and run data are shown first. Derived events are labelled, and playback-only features stay explicitly disabled until the backend emits replayable frames.
      </p>
    </div>

    <div class="trace-controls">
      <div class="trace-mode">
        <span class="trace-meta-chip">mode: {playback.mode}</span>
        <span class="trace-meta-chip">
          replay: {playback.canReplay ? 'available' : 'event focus only'}
        </span>
      </div>

      <div class="stepper" aria-label="Timeline stepper">
        <button
          type="button"
          class="step-btn"
          disabled={events.length === 0 || selectedIndex <= 0}
          onclick={() => onStepEvent?.(-1)}
        >
          Previous
        </button>
        <span class="step-status">
          {#if events.length === 0}
            no events
          {:else if selectedIndex === -1}
            none selected
          {:else}
            {selectedIndex + 1} / {events.length}
          {/if}
        </span>
        <button
          type="button"
          class="step-btn"
          disabled={events.length === 0 || selectedIndex === -1 || selectedIndex >= events.length - 1}
          onclick={() => onStepEvent?.(1)}
        >
          Next
        </button>
      </div>
    </div>
  </div>

  <div class="trace-missing">
    {#each playback.missingCapabilities.slice(0, 2) as note}
      <span>{note}</span>
    {/each}
  </div>

  <div class="trace-list" role="list">
    {#if events.length === 0}
      <div class="trace-empty">No trace events available for the current graph snapshot.</div>
    {:else}
      {#each events as event}
        <article
          class:selected={event.id === selectedEventId}
          class:placeholder={event.source === 'placeholder'}
          class="trace-card"
          role="listitem"
        >
          <div class="trace-card-header">
            <div>
              <p class="trace-kind">{event.kind}</p>
              <h3>{event.sequence}. {event.title}</h3>
            </div>
            <span class="trace-status {event.status}">{statusLabel(event.status)}</span>
          </div>

          <div class="trace-meta-row">
            <span class="trace-meta-chip">phase: {event.phase ?? 'cross-run'}</span>
            <span class="trace-meta-chip">source: {sourceLabel(event.source)}</span>
            <span class="trace-meta-chip">event: {event.id}</span>
          </div>

          <p class="trace-summary">{event.summary}</p>

          <div class="fact-row">
            {#each event.facts as fact}
              <span class="fact-chip">{fact.label}: {fact.value}</span>
            {/each}
          </div>

          <div class="trace-card-footer">
            <span class="trace-footnote">
              {#if event.playback.replayable}
                replayable
              {:else}
                jump focuses representative graph context
              {/if}
            </span>
            <button type="button" class="jump-btn" onclick={() => onSelectEvent?.(event.id)}>
              {event.id === selectedEventId ? 'Focused' : 'Jump to event'}
            </button>
          </div>
        </article>
      {/each}
    {/if}
  </div>
</section>

<style>
  .trace-panel {
    display: grid;
    gap: 12px;
    min-height: 240px;
    padding: 16px;
    border-top: 1px solid var(--color-border);
    background:
      linear-gradient(180deg, transparent, rgba(111, 163, 212, 0.06)),
      color-mix(in srgb, var(--color-surface) 94%, var(--color-bg));
  }

  .trace-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }

  .eyebrow,
  .trace-kind,
  .trace-status,
  .fact-chip,
  .trace-meta-chip,
  .trace-missing span,
  .step-btn,
  .jump-btn,
  .step-status,
  .trace-footnote {
    font-family: var(--font-ui);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--color-blue);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .trace-header h2 {
    margin: 0;
    font-size: 1.1rem;
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
  }

  .trace-intro {
    margin: 8px 0 0;
    max-width: 78ch;
    color: var(--color-text);
  }

  .trace-controls {
    display: grid;
    gap: 10px;
    justify-items: end;
  }

  .trace-mode,
  .trace-meta-row,
  .fact-row,
  .trace-missing {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .trace-meta-chip,
  .fact-chip,
  .trace-missing span {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 3px 8px;
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .trace-missing span {
    max-width: 44ch;
    color: var(--color-muted);
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .step-btn,
  .jump-btn {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-raised) 86%, transparent);
    color: var(--color-text);
    border-radius: 999px;
    min-height: 32px;
    padding: 0 10px;
    cursor: pointer;
    font-size: var(--text-meta);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .step-btn:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .step-status,
  .trace-footnote {
    color: var(--color-muted);
    font-size: var(--text-meta);
  }

  .trace-list {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(280px, 340px);
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .trace-empty,
  .trace-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
    padding: 12px;
  }

  .trace-card {
    display: grid;
    gap: 10px;
    min-height: 216px;
  }

  .trace-card.selected {
    border-color: var(--color-blue);
    box-shadow: 0 0 0 1px rgba(111, 163, 212, 0.28);
    background: color-mix(in srgb, var(--color-surface-raised) 72%, rgba(111, 163, 212, 0.08));
  }

  .trace-card.placeholder {
    border-style: dashed;
  }

  .trace-card-header,
  .trace-card-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  .trace-kind {
    margin: 0 0 4px;
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .trace-card h3 {
    margin: 0;
    font-size: 1rem;
    font-family: var(--font-ui);
  }

  .trace-status {
    text-transform: uppercase;
    font-size: var(--text-meta);
    color: var(--color-text);
  }

  .trace-status.warning {
    color: var(--color-coral);
  }

  .trace-status.active {
    color: var(--color-blue);
  }

  .trace-status.todo {
    color: var(--color-amber);
  }

  .trace-summary {
    margin: 0;
    color: var(--color-text);
    line-height: 1.65;
  }

  @media (max-width: 960px) {
    .trace-header {
      flex-direction: column;
    }

    .trace-controls {
      justify-items: start;
    }
  }
</style>
