<script lang="ts">
  import DialecticalTriangle from './DialecticalTriangle.svelte';

  interface Props {
    onNew?: () => void;
    onHistory?: () => void;
  }

  let { onNew, onHistory }: Props = $props();
</script>

<nav class="nav" aria-label="Main navigation">
  <a href="/" class="brand" aria-label="SOPHIA home">
    <DialecticalTriangle mode="logo" size={22} />
    <span class="brand-name">SOPHIA</span>
  </a>

  <div class="nav-actions">
    <button class="btn-ghost" onclick={onNew} aria-label="New conversation">
      + New
    </button>
    <button class="nav-link" onclick={onHistory} aria-label="Open history">
      History
    </button>
  </div>
</nav>

<style>
  .nav {
    height: 48px;
    width: 100%;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    position: fixed;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-4);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
  }

  .brand:hover {
    text-decoration: none;
  }

  .brand-name {
    font-family: var(--font-display);
    font-weight: 300;
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    color: var(--color-text);
  }

  .nav-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .btn-ghost {
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 6px 14px;
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);
  }

  .btn-ghost:hover {
    border-color: var(--color-dim);
    color: var(--color-text);
  }

  .nav-link {
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.05em;
    color: var(--color-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    transition: color var(--transition-fast);
  }

  .nav-link:hover {
    color: var(--color-text);
  }

  @media (max-width: 767px) {
    .btn-ghost {
      padding: 6px 10px;
    }
  }
</style>
