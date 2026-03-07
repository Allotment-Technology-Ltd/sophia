<script lang="ts">
  interface Props {
    onSubmit?: (text: string) => void;
    disabled?: boolean;
  }

  let { onSubmit, disabled = false }: Props = $props();

  let text = $state('');

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSubmit?.(text.trim());
    text = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="wrapper">
  <label class="label" for="follow-up-input">Any follow-up questions?</label>
  <textarea
    id="follow-up-input"
    bind:value={text}
    {disabled}
    class="textarea"
    rows="2"
    placeholder="Ask a follow-up…"
    onkeydown={handleKeydown}
  ></textarea>
  <div class="footer">
    <button
      class="follow-up-btn"
      onclick={handleSubmit}
      {disabled}
    >
      Follow up →
    </button>
  </div>
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .label {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    display: block;
  }

  .textarea {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 12px 16px;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 300;
    color: var(--color-text);
    min-height: 64px;
    resize: vertical;
    line-height: 1.65;
    transition: border-color var(--transition-fast);
  }

  .textarea::placeholder {
    color: var(--color-dim);
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

  .footer {
    display: flex;
    justify-content: flex-end;
  }

  .follow-up-btn {
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 8px 16px;
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);
  }

  .follow-up-btn:hover:not(:disabled) {
    border-color: var(--color-dim);
    color: var(--color-text);
  }

  .follow-up-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
