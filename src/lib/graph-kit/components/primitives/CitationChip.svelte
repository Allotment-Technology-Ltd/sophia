<script lang="ts">
  import type { GraphKitProvenanceItem } from '$lib/graph-kit/types';

  interface Props {
    item: GraphKitProvenanceItem;
  }

  let { item }: Props = $props();
</script>

<div class="citation-chip" title={item.rationale ?? item.value}>
  <span class="citation-kind">{item.kind}</span>
  <span class="citation-label">{item.label}</span>
</div>

<style>
  .citation-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--color-surface-raised) 86%, transparent);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    line-height: 1;
  }

  .citation-kind {
    color: var(--color-blue);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .citation-label {
    color: var(--color-muted);
  }
</style>
