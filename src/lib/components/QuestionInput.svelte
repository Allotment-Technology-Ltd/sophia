<script lang="ts">
  interface Props {
    value?: string;
    onSubmit?: () => void;
    disabled?: boolean;
    onkeydown?: (e: KeyboardEvent) => void;
  }

  let { value = $bindable(''), onSubmit, disabled = false, onkeydown }: Props = $props();

  let charCount = $derived(value.length);
</script>

<div class="wrapper">
  <div class="input-container">
    <textarea
      bind:value
      {disabled}
      placeholder="What do you want to think about today?"
      class="textarea"
      {onkeydown}
    ></textarea>
    <span class="char-count" aria-label="{charCount} characters">{charCount}</span>
  </div>
</div>

<style>
  .wrapper {
    width: 100%;
    max-width: 700px;
    margin: 0 auto;
  }

  .input-container {
    position: relative;
    width: 100%;
  }

  .textarea {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 16px 20px;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 300;
    color: var(--color-text);
    min-height: 120px;
    resize: vertical;
    line-height: 1.85;
    transition: border-color var(--transition-fast);
  }

  .textarea::placeholder {
    color: var(--color-muted);
    font-style: italic;
  }

  .textarea:focus {
    outline: none;
    border-color: var(--color-sage-border);
  }

  .textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .char-count {
    position: absolute;
    bottom: 10px;
    right: 14px;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-dim);
    pointer-events: none;
    user-select: none;
  }
</style>
