<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';

  let pageState = $state<'loading' | 'ready' | 'forbidden'>('loading');
  let currentUserEmail = $state<string | null>(null);
  let errorMessage = $state('');

  async function loadAdminContext(): Promise<void> {
    const token = await getIdToken();
    if (!token) {
      pageState = 'forbidden';
      throw new Error('Authentication required');
    }

    const response = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 403 || body.is_admin === false) {
      pageState = 'forbidden';
      currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
      return;
    }

    if (!response.ok) {
      throw new Error(body.error ?? `status ${response.status}`);
    }

    currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
    pageState = body.is_admin ? 'ready' : 'forbidden';
  }

  onMount(() => {
    if (!browser) return;

    const sync = async () => {
      if (!auth?.currentUser) {
        pageState = 'forbidden';
        await goto('/auth');
        return;
      }

      try {
        await loadAdminContext();
      } catch (error) {
        errorMessage =
          error instanceof Error ? error.message : 'Failed to load administrator context';
      }
    };

    void sync();
    const unsubscribe = onAuthChange((user) => {
      if (!user) {
        pageState = 'forbidden';
        void goto('/auth');
        return;
      }
      void sync();
    });

    return () => {
      unsubscribe();
    };
  });
</script>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-6xl px-6 py-8 space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="mb-1 text-3xl font-serif text-sophia-dark-text">Ingestion Routing</h1>
        <p class="font-mono text-sm text-sophia-dark-muted">
          Status and implementation boundary for the Restormel-driven ingestion mixer.
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <a
          href="/admin/operations"
          class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
        >
          Operations Console
        </a>
        <a
          href="/admin"
          class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
        >
          ← Back to Admin
        </a>
      </div>
    </div>

    {#if pageState === 'loading'}
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 font-mono text-sm text-sophia-dark-muted">
        Loading administrator context…
      </div>
    {:else if pageState === 'forbidden'}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-6">
        <h2 class="mb-2 text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
        <p class="font-mono text-sm text-sophia-dark-copper">
          {currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
        </p>
      </div>
    {:else}
      {#if errorMessage}
        <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
          {errorMessage}
        </div>
      {/if}

      <section class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-5">
        <div class="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-sophia-dark-copper">Status</div>
        <h2 class="mb-2 text-xl font-serif text-sophia-dark-text">Full mixer is intentionally not shipped yet</h2>
        <p class="max-w-4xl text-sm leading-6 text-sophia-dark-text">
          Sophia will not ship a local custom routing editor for ingestion. The intended admin experience
          still depends on stable Restormel Dashboard control-plane APIs. Some of the missing metadata
          endpoints are now live, but route discovery, step reads, resolve, and simulate are still
          failing against the current Sophia project.
        </p>
      </section>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
          <div>
            <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
              Available Today
            </div>
            <p class="text-sm text-sophia-dark-muted">
              These public Restormel surfaces are already usable in Sophia.
            </p>
          </div>

          <ul class="space-y-3 font-mono text-sm text-sophia-dark-text">
            <li>Dashboard policy evaluate for entitlement and governance checks</li>
            <li>Dashboard routing capabilities for ingestion workloads and stages</li>
            <li>Dashboard provider health and switch-criteria enums</li>
            <li>MCP runtime for operator tooling and agent workflows</li>
            <li>AAIF contract shape for typed request and response envelopes</li>
          </ul>
        </section>

        <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
          <div>
            <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
              Missing Public APIs
            </div>
            <p class="text-sm text-sophia-dark-muted">
              These are the blocking control-plane capabilities for the intended stage mixer.
            </p>
          </div>

          <ul class="space-y-3 font-mono text-sm text-sophia-dark-text">
            <li>Stable route list and route detail reads</li>
            <li>Stable route-step reads for existing routes</li>
            <li>Stage-aware resolve with task, cost, latency, and failure context</li>
            <li>Rich switchover criteria beyond the current `fallbackOn` field</li>
            <li>Stable route simulation and stage-cost preview</li>
            <li>Draft validation, publish, rollback, and route history</li>
          </ul>
        </section>
      </div>

      <section class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-5 space-y-3">
        <div class="mb-1 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-copper">
          Current Live Probe
        </div>
        <p class="text-sm leading-6 text-sophia-dark-text">
          Direct probes against Sophia’s current Restormel project on 2026-03-19 found that some of the
          previously missing metadata endpoints are now live, but the core route-control endpoints are
          still failing.
        </p>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 font-mono text-sm text-sophia-dark-text">
            <div>`POST /policies/evaluate` → `200`</div>
            <div>`GET /projects/&#123;projectId&#125;/routing-capabilities` → `200`</div>
            <div>`GET /projects/&#123;projectId&#125;/providers/health` → `200`</div>
            <div>`GET /projects/&#123;projectId&#125;/switch-criteria-enums` → `200`</div>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 font-mono text-sm text-sophia-dark-text">
            <div>`POST /projects/&#123;projectId&#125;/resolve` → `500`</div>
            <div>`GET /projects/&#123;projectId&#125;/routes` → `500`</div>
            <div>`GET /projects/&#123;projectId&#125;/routes/&#123;routeId&#125;/steps` → `500`</div>
            <div>`POST /projects/&#123;projectId&#125;/routes/&#123;routeId&#125;/simulate` → `500`</div>
            <div>`publish`, `rollback`, `history` route paths → `404`</div>
          </div>
        </div>
      </section>

      <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
        <div>
          <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
            Sophia Posture
          </div>
          <p class="text-sm text-sophia-dark-muted">
            The app stays aligned to Restormel as the future control plane rather than growing its own
            routing system.
          </p>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Bootstrap</div>
            <p class="font-mono text-sm text-sophia-dark-text">
              `RESTORMEL_INGEST_*_ROUTE_ID` env vars remain operational bootstrap only.
            </p>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Manual Override</div>
            <p class="font-mono text-sm text-sophia-dark-text">
              `ingest_provider` in admin operations remains a coarse fallback hint, not a routing editor.
            </p>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="mb-1 font-mono text-xs text-sophia-dark-muted">Source Of Truth</div>
            <p class="font-mono text-sm text-sophia-dark-text">
              Final routing state must live in Restormel, not in Sophia DB, env, or browser state.
            </p>
          </div>
        </div>
      </section>

      <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
        <div class="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
          Repo Specs
        </div>
        <div class="space-y-3 font-mono text-sm text-sophia-dark-text">
          <p>`docs/restormel-integration/ingestion-control-plane-spec.md`</p>
          <p>`docs/restormel-integration/upstream-findings-report.md`</p>
          <p>`docs/restormel-integration/mcp-aaif-operator-guide.md`</p>
        </div>
      </section>
    {/if}
  </div>
</div>
