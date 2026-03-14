<script lang="ts">
  interface Props {
    label: string;
  }

  let { label }: Props = $props();
</script>

<span class="source-badge">{label}</span>

<style>
  .source-badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-teal-border);
    border-radius: 999px;
    padding: 3px 8px;
    background: var(--color-teal-bg);
    color: var(--color-teal);
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    line-height: 1;
  }
</style>
