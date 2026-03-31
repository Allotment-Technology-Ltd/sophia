<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'ghost' | 'link';
    disabled?: boolean;
    onclick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    children: Snippet;
  }

  let { variant = 'primary', disabled = false, onclick, type = 'button', children }: Props = $props();
</script>

<button class="btn btn-{variant}" {disabled} {onclick} {type}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 2px;
    transition: filter var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .btn:disabled {
    cursor: not-allowed;
  }

  /* Primary */
  .btn-primary {
    background: var(--color-sage);
    color: var(--color-bg);
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 1.05rem;
    font-weight: 400;
    padding: 12px 28px;
    border: none;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .btn-primary:disabled {
    opacity: 0.35;
  }

  /* Ghost */
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    padding: 8px 16px;
  }

  .btn-ghost:hover:not(:disabled) {
    border-color: var(--color-dim);
    color: var(--color-text);
  }

  .btn-ghost:disabled {
    opacity: 0.35;
  }

  /* Link */
  .btn-link {
    background: none;
    border: none;
    color: var(--color-blue);
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 1rem;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .btn-link:hover:not(:disabled) {
    color: var(--color-sage);
  }

  .btn-link:disabled {
    opacity: 0.35;
  }
</style>
