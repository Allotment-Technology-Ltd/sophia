<script lang="ts">
  interface Props {
    note: string;
    tone?: 'info' | 'warning' | 'error';
  }

  let { note, tone = 'warning' }: Props = $props();
</script>

<div class="validation-note {tone}">
  <span class="validation-label">{tone}</span>
  <p>{note}</p>
</div>

<style>
  .validation-note {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 10px;
    display: grid;
    gap: 6px;
    background: color-mix(in srgb, var(--color-surface-raised) 84%, transparent);
  }

  .validation-note.warning {
    border-color: var(--color-amber-border);
    background: color-mix(in srgb, var(--color-amber-bg) 42%, var(--color-surface-raised));
  }

  .validation-note.error {
    border-color: var(--color-coral-border);
    background: color-mix(in srgb, var(--color-coral-bg) 36%, var(--color-surface-raised));
  }

  .validation-note.info {
    border-color: var(--color-blue-border);
    background: color-mix(in srgb, var(--color-blue-bg) 32%, var(--color-surface-raised));
  }

  .validation-label {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-muted);
  }

  p {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.4;
  }
</style>
