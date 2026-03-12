<script lang="ts">
  import type { RelationType } from '$lib/types/references';

  interface Props {
    type: RelationType;
    label: string;
    delay?: number;  // stagger delay in ms
  }

  let { type, label, delay = 0 }: Props = $props();
</script>

<span
  class="relation-tag {type}"
  style="animation-delay: {delay}ms"
>
  {label}
</span>

<style>
  .relation-tag {
    display: inline-block;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 2px;
    line-height: 1.4;
    white-space: nowrap;
    opacity: 0;
    animation: relation-fade-in 0.6s ease forwards;
  }

  .supports {
    color: var(--color-sage);
    background: var(--color-sage-bg);
  }

  .contradicts {
    color: var(--color-copper);
    background: var(--color-copper-bg);
  }

  .responds-to {
    color: var(--color-blue);
    background: var(--color-blue-bg);
  }

  .depends-on {
    color: var(--color-dim);
    background: var(--color-surface-raised);
  }

  .defines {
    color: var(--color-blue);
    background: color-mix(in srgb, var(--color-blue-bg) 78%, white 22%);
  }

  .qualifies {
    color: var(--color-amber);
    background: color-mix(in srgb, var(--color-amber) 16%, white 84%);
  }

  @keyframes relation-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  :global(html.reduce-motion) .relation-tag {
    animation-duration: 0.01ms !important;
  }
</style>
