<script lang="ts">
  import type { BadgeVariant } from '$lib/types/references';

  interface Props {
    variant: BadgeVariant;
  }

  let { variant }: Props = $props();
</script>

<span class="claim-badge {variant}">{variant}</span>

<style>
  .claim-badge {
    display: inline-block;
    font-family: var(--font-ui);
    font-weight: 400;
    font-size: var(--text-label);
    text-transform: uppercase;
    letter-spacing: 0.10em;
    padding: 4px 10px;
    border-radius: 2px;
    border: 1px solid;
    line-height: 1;
    white-space: nowrap;
  }

  .thesis {
    background: var(--color-sage-bg);
    color: var(--color-sage);
    border-color: var(--color-sage-border);
  }

  .premise {
    background: var(--color-blue-bg);
    color: var(--color-blue);
    border-color: var(--color-blue-border);
  }

  .objection {
    background: var(--color-copper-bg);
    color: var(--color-copper);
    border-color: var(--color-copper-border);
  }

  .response {
    background: var(--color-sage-bg);
    color: var(--color-sage);
    border-color: var(--color-sage-border);
  }

  .definition {
    background: transparent;
    color: var(--color-muted);
    border-color: var(--color-border);
  }

  .empirical {
    background: var(--color-blue-bg);
    color: var(--color-blue);
    border-color: var(--color-blue-border);
  }
</style>
