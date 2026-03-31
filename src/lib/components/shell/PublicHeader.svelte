<script lang="ts">
  import { page } from '$app/stores';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';

  export interface PublicHeaderLink {
    href: string;
    label: string;
  }

  interface Props {
    links: PublicHeaderLink[];
  }

  let { links }: Props = $props();
  let menuOpen = $state(false);
  const menuId = 'public-nav-links';

  function isActive(href: string): boolean {
    if (href.startsWith('#')) return false;
    const path = $page.url.pathname;
    if (href === '/') return path === '/';
    return path === href || path.startsWith(`${href}/`);
  }

  function closeMenu(): void {
    menuOpen = false;
  }
</script>

<header class="public-header" class:is-open={menuOpen} aria-label="Primary navigation">
  <a class="brand" href="/" aria-label="SOPHIA home" onclick={closeMenu}>
    <DialecticalTriangle mode="logo" size={20} />
    <span>SOPHIA</span>
  </a>

  <button
    class="menu-toggle"
    type="button"
    aria-expanded={menuOpen}
    aria-controls={menuId}
    aria-label="Toggle navigation"
    onclick={() => (menuOpen = !menuOpen)}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="14" height="1" rx="0.5" fill="currentColor" />
      <rect x="1" y="7.5" width="14" height="1" rx="0.5" fill="currentColor" />
      <rect x="1" y="12" width="14" height="1" rx="0.5" fill="currentColor" />
    </svg>
  </button>

  <nav id={menuId} class="nav-links" aria-label="Marketing navigation">
    {#each links as link (link.href + link.label)}
      <a
        href={link.href}
        aria-current={isActive(link.href) ? 'page' : undefined}
        onclick={closeMenu}
      >
        {link.label}
      </a>
    {/each}
  </nav>
</header>

<style>
  .public-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface);
    padding: 10px 12px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
  }

  .brand span {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    color: var(--color-text);
    line-height: 1;
  }

  .nav-links {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .nav-links a {
    text-decoration: none;
    color: var(--color-muted);
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 7px;
  }

  .nav-links a:hover,
  .nav-links a[aria-current='page'] {
    color: var(--color-text);
    border-color: var(--color-border);
    background: var(--color-surface-raised);
  }

  .menu-toggle {
    display: none;
    width: 34px;
    height: 34px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface-raised);
    color: var(--color-text);
    cursor: pointer;
    padding: 0;
  }

  @media (max-width: 760px) {
    .menu-toggle {
      display: inline-flex;
    }

    .nav-links {
      display: none;
      grid-column: 1 / -1;
      flex-direction: column;
      align-items: stretch;
      border-top: 1px solid var(--color-border);
      padding-top: 8px;
      gap: 6px;
    }

    .public-header.is-open .nav-links {
      display: flex;
    }

    .nav-links a {
      padding: 8px 10px;
      text-align: left;
    }
  }
</style>
