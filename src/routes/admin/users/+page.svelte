<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';

  type RowRole = 'owner' | 'user';

  interface ListedUser {
    uid: string;
    email: string | null;
    display_name: string | null;
    role: RowRole;
  }

  let loading = $state(true);
  let loadError = $state('');
  let saveError = $state('');
  let saveMessage = $state('');
  let users = $state<ListedUser[]>([]);
  /** Pending role per uid before Save */
  let pendingRole = $state<Record<string, RowRole>>({});
  let savingUid = $state<string | null>(null);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      const detail = typeof body.detail === 'string' ? body.detail : '';
      const title = typeof body.title === 'string' ? body.title : '';
      const err = typeof body.error === 'string' ? body.error : '';
      throw new Error(detail || err || title || `Request failed (${res.status})`);
    }
    return body;
  }

  async function loadUsers(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const token = await getIdToken();
      if (!token) {
        loadError = 'Sign in to manage users.';
        users = [];
        return;
      }
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
      const body = await parseJsonResponse(res);
      const raw = body.users;
      const list: ListedUser[] = Array.isArray(raw)
        ? (raw as ListedUser[]).map((u) => ({
            uid: u.uid,
            email: u.email ?? null,
            display_name: u.display_name ?? null,
            role: u.role === 'owner' ? 'owner' : 'user'
          }))
        : [];
      users = list;
      const next: Record<string, RowRole> = {};
      for (const u of list) next[u.uid] = u.role;
      pendingRole = next;
    } catch (e) {
      users = [];
      loadError = e instanceof Error ? e.message : 'Failed to load users.';
    } finally {
      loading = false;
    }
  }

  async function saveRole(uid: string): Promise<void> {
    saveError = '';
    saveMessage = '';
    const role = pendingRole[uid];
    if (!role) return;
    savingUid = uid;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ role })
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      if (!res.ok) {
        const msg =
          typeof body.error === 'string'
            ? body.error
            : typeof body.detail === 'string'
              ? body.detail
              : `Save failed (${res.status})`;
        saveError = msg;
        return;
      }
      saveMessage = 'Role updated.';
      const idx = users.findIndex((u) => u.uid === uid);
      if (idx >= 0) {
        users[idx] = { ...users[idx], role };
        users = [...users];
      }
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed.';
    } finally {
      savingUid = null;
    }
  }

  onMount(() => {
    void loadUsers();
  });
</script>

<svelte:head>
  <title>User management — Admin</title>
</svelte:head>

<main class="users-page">
  <header class="users-hero">
    <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
    <h1 class="mt-2 font-serif text-2xl text-sophia-dark-text sm:text-3xl">User management</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
      Owners can promote users to owner or demote owners to user. The service must always keep at least one owner.
      If an email is listed in <span class="font-mono">OWNER_EMAILS</span>, that account is merged back to owner on the
      next authenticated API request.
    </p>
    <div class="mt-4 flex flex-wrap gap-3">
      <a href="/admin" class="admin-hub-action">Admin home</a>
      <button type="button" class="admin-hub-action" onclick={() => loadUsers()} disabled={loading}>
        Refresh list
      </button>
    </div>
  </header>

  {#if loadError}
    <p class="mt-6 rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-200" role="alert">
      {loadError}
    </p>
  {/if}

  {#if saveError}
    <p class="mt-4 rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-200" role="alert">
      {saveError}
    </p>
  {/if}

  {#if saveMessage && !saveError}
    <p class="mt-4 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100">
      {saveMessage}
    </p>
  {/if}

  <section class="mt-8" aria-labelledby="users-table-heading">
    <h2 id="users-table-heading" class="sr-only">Registered users</h2>

    {#if loading}
      <p class="text-sm text-sophia-dark-muted">Loading users…</p>
    {:else if users.length === 0 && !loadError}
      <p class="text-sm text-sophia-dark-muted">No user documents found in Firestore.</p>
    {:else if users.length > 0}
      <div class="table-wrap">
        <table class="users-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Display name</th>
              <th scope="col">UID</th>
              <th scope="col">Role</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each users as u (u.uid)}
              <tr>
                <td>{u.email ?? '—'}</td>
                <td>{u.display_name ?? '—'}</td>
                <td class="font-mono text-xs">{u.uid}</td>
                <td>
                  <label class="sr-only" for="role-{u.uid}">Role for {u.email ?? u.uid}</label>
                  <select
                    id="role-{u.uid}"
                    class="role-select"
                    value={pendingRole[u.uid] ?? u.role}
                    disabled={savingUid === u.uid}
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value as RowRole;
                      pendingRole = { ...pendingRole, [u.uid]: v };
                    }}
                  >
                    <option value="user">User</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    class="save-btn"
                    disabled={savingUid === u.uid || pendingRole[u.uid] === u.role}
                    onclick={() => saveRole(u.uid)}
                  >
                    {savingUid === u.uid ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</main>

<style>
  .users-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1120px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .users-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.12), rgba(44, 96, 142, 0.1));
    border-radius: 12px;
    padding: 20px;
  }
  .admin-hub-action {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text);
    text-decoration: none;
    cursor: pointer;
  }
  .admin-hub-action:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .admin-hub-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
  }
  .users-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .users-table th,
  .users-table td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }
  .users-table th {
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted, var(--color-text));
    opacity: 0.85;
  }
  .users-table tr:last-child td {
    border-bottom: none;
  }
  .role-select {
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-bg, var(--color-surface));
    color: var(--color-text);
  }
  .save-btn {
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-sage) 22%, var(--color-surface));
    color: var(--color-text);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .save-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-sage) 55%, var(--color-border));
  }
  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
