<script lang="ts">
  import type { Claim, RelationBundle } from '@restormel/contracts/references';
  import ClaimBadge from './ClaimBadge.svelte';
  import RelationTag from './RelationTag.svelte';

  interface Props {
    claim: Claim;
    relations?: RelationBundle;
  }

  let { claim, relations }: Props = $props();
</script>

<div class="claim-row">
  <div class="claim-header">
    <ClaimBadge variant={claim.badge} />
  </div>
  <p class="claim-text">{claim.text}</p>
  {#if relations && relations.relations.length > 0}
    <div class="relation-tags">
      {#each relations.relations as rel, i (`${rel.type}:${rel.target}:${i}`)}
        <RelationTag type={rel.type} label={rel.label} delay={i * 300} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .claim-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .claim-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .claim-text {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    color: var(--color-text);
    margin: 0;
  }

  .relation-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
