<script lang="ts">
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>SOPHIA API Access</title>
</svelte:head>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-3xl px-6 py-16">
    <h1 class="mb-3 font-serif text-4xl">SOPHIA Reasoning API</h1>
    <p class="mb-10 font-mono text-sm text-sophia-dark-muted">
      Join the developer waitlist for early access to the domain-agnostic reasoning verification API.
    </p>
    <p class="mb-6 font-mono text-xs text-sophia-dark-muted">
      Phase 1 developer tooling is now available at
      <a class="text-sophia-dark-sage underline" href="/developer">/developer</a>.
    </p>

    <form method="POST" class="space-y-5 rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
      <label class="block">
        <span class="mb-2 block font-mono text-xs text-sophia-dark-muted">NAME</span>
        <input
          class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
          name="name"
          required
          value={form?.values?.name ?? ''}
        />
      </label>

      <label class="block">
        <span class="mb-2 block font-mono text-xs text-sophia-dark-muted">EMAIL</span>
        <input
          class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
          name="email"
          type="email"
          required
          value={form?.values?.email ?? ''}
        />
      </label>

      <label class="block">
        <span class="mb-2 block font-mono text-xs text-sophia-dark-muted">USE CASE</span>
        <textarea
          class="min-h-32 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
          name="use_case"
          required
        >{form?.values?.useCase ?? ''}</textarea>
      </label>

      {#if form?.error}
        <p class="font-mono text-xs text-sophia-dark-copper">{form.error}</p>
      {/if}

      {#if form?.success}
        <p class="font-mono text-xs text-sophia-dark-sage">Thanks. You are on the waitlist.</p>
      {/if}

      <button
        type="submit"
        class="rounded border border-sophia-dark-sage px-4 py-2 font-mono text-sm text-sophia-dark-sage transition hover:bg-sophia-dark-sage/10"
      >
        Request Access
      </button>
    </form>
  </div>
</div>
