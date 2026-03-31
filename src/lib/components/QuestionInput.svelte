<script lang="ts">
  interface Props {
    value?: string;
    onSubmit?: () => void;
    disabled?: boolean;
    onkeydown?: (e: KeyboardEvent) => void;
    placeholder?: string;
  }

  let {
    value = $bindable(''),
    onSubmit,
    disabled = false,
    onkeydown,
    placeholder = 'What do you want to think about today?'
  }: Props = $props();

  let charCount = $derived(value.length);
</script>

<div class="wrapper">
  <div class="input-container">
    <textarea
      bind:value
      {disabled}
      {placeholder}
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
    font-family: var(--font-body); /* was --font-display: landing-only restriction applied */
    font-size: 1rem;
    font-weight: 400;
    color: var(--color-text);
    min-height: 120px;
    resize: vertical;
    line-height: 1.85;
    transition: border-color var(--transition-fast);
  }

  .textarea::placeholder {
    color: color-mix(in srgb, var(--color-muted) 72%, var(--color-text) 28%);
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
    font-size: var(--text-label);
    color: var(--color-muted);
    pointer-events: none;
    user-select: none;
  }
</style>
