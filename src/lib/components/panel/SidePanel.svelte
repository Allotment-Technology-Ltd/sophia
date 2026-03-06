<script lang="ts">
  import { type Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    children?: Snippet;
  }

  let { open, onClose, children }: Props = $props();

  // Scroll lock on mobile when open
  $effect(() => {
    if (typeof document === 'undefined') return;
    const isMobile = window.innerWidth < 768;
    if (open && isMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  });

  // Escape key to close
  $effect(() => {
    if (typeof document === 'undefined') return;
    function handleKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  // Mobile focus management
  let closeButton: HTMLButtonElement | undefined = $state();
  $effect(() => {
    if (typeof document === 'undefined') return;
    const isMobile = window.innerWidth < 768;
    if (isMobile && open && closeButton) {
      // Focus close button when panel opens on mobile
      closeButton.focus();
    }
  });

  // Viewport width for aria role switching
  let viewportWidth = $state(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  $effect(() => {
    if (typeof window === 'undefined') return;
    function handleResize(): void { viewportWidth = window.innerWidth; }
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  });

  let isDesktop = $derived(viewportWidth >= 768);
  let panelRole = $derived(isDesktop ? 'complementary' : 'dialog');
  let ariaModal = $derived(isDesktop ? undefined : true);
  let ariaLabel = $derived(
    isDesktop ? 'References and navigation' : 'Navigation'
  );
</script>

{#if !isDesktop && open}
  <!-- Mobile backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="panel-backdrop"
    class:is-open={open}
    onclick={onClose}
    aria-hidden="true"
  ></div>
{/if}

<aside
  id="side-panel"
  class="side-panel"
  class:is-open={open}
  role={panelRole}
  aria-label={ariaLabel}
  aria-modal={ariaModal}
>
  <!-- Close button -->
  <button
    bind:this={closeButton}
    class="close-btn"
    aria-label="Close panel"
    onclick={onClose}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Panel content (tabs injected here) -->
  <div class="panel-body">
    {@render children?.()}
  </div>
</aside>

<style>
  /* ── Backdrop (mobile only) ── */
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
    background: rgba(0, 0, 0, 0);
    pointer-events: none;
    transition: background 0.35s ease;
  }

  .panel-backdrop.is-open {
    background: rgba(0, 0, 0, 0.5);
    pointer-events: all;
  }

  /* ── Panel ── */
  .side-panel {
    position: fixed;
    top: var(--nav-height);
    right: 0;
    bottom: 0;
    z-index: 50;
    width: 380px;
    background: var(--color-surface);
    border-left: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    transform: translateX(100%);
    opacity: 0;
    transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease;
    will-change: transform, opacity;
  }

  .side-panel.is-open {
    transform: translateX(0);
    opacity: 1;
  }

  /* ── Close button ── */
  .close-btn {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-muted);
    border-radius: var(--radius-md);
    transition: color var(--transition-fast);
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  /* ── Panel body ── */
  .panel-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-top: 40px; /* clear close button */
  }

  /* ── Mobile: full-width overlay ── */
  @media (max-width: 767px) {
    .side-panel {
      width: 100vw;
    }
  }

  /* ── Reduced Motion: suppress all transitions ── */
  :global(html.reduce-motion) .side-panel,
  :global(html.reduce-motion) .panel-backdrop,
  :global(html.reduce-motion) .close-btn {
    transition: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .side-panel,
    .panel-backdrop,
    .close-btn {
      transition: none !important;
    }
  }
</style>
