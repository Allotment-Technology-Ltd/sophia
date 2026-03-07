<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();
</script>

<div class="epistemic">
  <div class="eyebrow">Epistemic Status</div>
  <p class="content">{content}</p>
</div>

<style>
  .epistemic {
    background: var(--color-blue-bg);
    border: 1px solid var(--color-blue-border);
    border-radius: 3px;
    padding: 20px 24px;
  }

  .eyebrow {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-blue);
    margin-bottom: 8px;
  }

  .content {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    margin: 0;
    line-height: 1.65;
  }
</style>
