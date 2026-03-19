<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { auth, getIdToken, onAuthChange } from '$lib/firebase';
	import type { AdminDashboardData } from '$lib/server/adminDashboard';

	const emptyDashboard: AdminDashboardData = {
		stats: {
			sources: 0,
			claims: 0,
			arguments: 0,
			relations: 0
		},
		sources: [],
		domainDistribution: [],
		relationDistribution: [],
		averageValidationScore: null,
		recentIngestions: [],
		apiKeys: []
	};

	let dashboard = $state<AdminDashboardData>(emptyDashboard);
	let pageState = $state<'loading' | 'ready' | 'forbidden'>('loading');
	let currentUserEmail = $state<string | null>(null);
	let errorMessage = $state('');
	let successMessage = $state('');
	let requestState = $state<'idle' | 'submitting'>('idle');
	let generatedKey = $state<string | null>(null);
	let keyName = $state('');
	let keyOwnerUid = $state('');
	let keyDailyQuota = $state('100');
	let sortColumn = $state<'title' | 'source_type' | 'claim_count' | 'status' | 'ingested_at'>('ingested_at');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	const sortedSources = $derived.by(() => {
		const sources = [...dashboard.sources];
		sources.sort((a, b) => {
			const aVal = a[sortColumn];
			const bVal = b[sortColumn];

			if (aVal === null || aVal === undefined) return 1;
			if (bVal === null || bVal === undefined) return -1;
			if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
			if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
			return 0;
		});
		return sources;
	});

	const maxDomainCount = $derived(Math.max(...dashboard.domainDistribution.map((item) => item.count), 1));
	const maxRelationCount = $derived(
		Math.max(...dashboard.relationDistribution.map((item) => item.count), 1)
	);
	const activityCards = $derived.by(() => [
		{
			title: 'Run Operations',
			description: 'Launch imports, validate, diagnose, replay, and sync flows.',
			href: '/admin/operations',
			metric: `${dashboard.recentIngestions.length} recent ingestion runs`
		},
		{
			title: 'Review Queue',
			description: 'Promote trusted claims and relations into the serving graph.',
			href: '/admin/review',
			metric: `${dashboard.stats.claims} claims currently stored`
		},
		{
			title: 'Manage Access',
			description: 'Issue keys and inspect current API access from one place.',
			href: '#api-keys',
			metric: `${dashboard.apiKeys.filter((key) => key.active).length} active API keys`
		}
	]);

	function toggleSort(column: typeof sortColumn): void {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortColumn = column;
		sortDirection = 'desc';
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		return new Date(dateStr).toLocaleDateString('en-GB', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getBadgeColor(status: string): string {
		switch (status) {
			case 'ingested':
				return 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40';
			case 'validated':
				return 'bg-sophia-dark-blue/20 text-sophia-dark-blue border-sophia-dark-blue/40';
			case 'quarantined':
				return 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40';
			default:
				return 'bg-sophia-dark-surface-raised text-sophia-dark-dim border-sophia-dark-border';
		}
	}

	async function authorizedJson(url: string, init?: RequestInit): Promise<any> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required');
		const response = await fetch(url, {
			...init,
			headers: {
				...(init?.headers ?? {}),
				Authorization: `Bearer ${token}`
			}
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message =
				typeof body?.error === 'string' ? body.error : `Request failed with status ${response.status}`;
			const error = new Error(message);
			(error as Error & { status?: number }).status = response.status;
			throw error;
		}
		return body;
	}

	async function refreshDashboard(): Promise<void> {
		const body = await authorizedJson('/api/admin/dashboard');
		dashboard = {
			...emptyDashboard,
			...body
		};
		if (!keyOwnerUid && auth?.currentUser?.uid) {
			keyOwnerUid = auth.currentUser.uid;
		}
	}

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
		if (!keyOwnerUid) {
			keyOwnerUid = body.user?.uid ?? auth?.currentUser?.uid ?? '';
		}
		pageState = body.is_admin ? 'ready' : 'forbidden';
		if (pageState === 'ready') {
			await refreshDashboard();
		}
	}

	async function generateKey(): Promise<void> {
		requestState = 'submitting';
		errorMessage = '';
		successMessage = '';
		generatedKey = null;

		try {
			const dailyQuota = Number(keyDailyQuota);
			const body = await authorizedJson('/api/admin/api-keys', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name: keyName || undefined,
					owner_uid: keyOwnerUid || undefined,
					daily_quota: Number.isFinite(dailyQuota) ? dailyQuota : undefined
				})
			});
			generatedKey = body.generatedKey ?? null;
			successMessage = `Created key ${body.keyId} for ${body.owner_uid}.`;
			keyName = '';
			await refreshDashboard();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to create API key';
		} finally {
			requestState = 'idle';
		}
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
	<div class="mx-auto max-w-7xl px-6 py-8">
		<div class="mb-8 flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="mb-1 text-3xl font-serif text-sophia-dark-text">Admin Hub</h1>
				<p class="font-mono text-sm text-sophia-dark-muted">
					Operate ingestion, review graph promotion, and manage access from one control plane.
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
					href="/admin/review"
					class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
				>
					Review Queue
				</a>
				<a
					href="/"
					class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
				>
					App
				</a>
			</div>
		</div>

		{#if pageState === 'loading'}
			<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 font-mono text-sm text-sophia-dark-muted">
				Loading administrator context...
			</div>
		{:else if pageState === 'forbidden'}
			<div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-6">
				<h2 class="mb-2 text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
				<p class="font-mono text-sm text-sophia-dark-copper">
					{currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
				</p>
			</div>
		{:else}
			<div class="mb-8 grid gap-4 lg:grid-cols-3">
				{#each activityCards as card}
					<a
						href={card.href}
						class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 transition-colors hover:bg-sophia-dark-surface-raised"
					>
						<div class="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-sophia-dark-muted">
							{card.title}
						</div>
						<p class="mb-4 text-sm leading-6 text-sophia-dark-text">{card.description}</p>
						<div class="font-mono text-sm text-sophia-dark-blue">{card.metric}</div>
					</a>
				{/each}
			</div>

			{#if successMessage}
				<div class="mb-6 rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 p-4 font-mono text-sm text-sophia-dark-sage">
					{successMessage}
				</div>
			{/if}

			{#if errorMessage || dashboard.error}
				<div class="mb-6 rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
					{errorMessage || dashboard.error}
				</div>
			{/if}

			{#if generatedKey}
				<div class="mb-6 rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 p-4">
					<div class="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-sophia-dark-blue">
						New key
					</div>
					<p class="break-all font-mono text-sm text-sophia-dark-text">{generatedKey}</p>
				</div>
			{/if}

			<div class="mb-8 grid gap-4 md:grid-cols-4">
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-1 text-xs font-mono text-sophia-dark-muted">Sources</div>
					<div class="text-3xl font-mono text-sophia-dark-text">{dashboard.stats.sources}</div>
				</div>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-1 text-xs font-mono text-sophia-dark-muted">Claims</div>
					<div class="text-3xl font-mono text-sophia-dark-text">{dashboard.stats.claims}</div>
				</div>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-1 text-xs font-mono text-sophia-dark-muted">Arguments</div>
					<div class="text-3xl font-mono text-sophia-dark-text">{dashboard.stats.arguments}</div>
				</div>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-1 text-xs font-mono text-sophia-dark-muted">Relations</div>
					<div class="text-3xl font-mono text-sophia-dark-text">{dashboard.stats.relations}</div>
				</div>
			</div>

			<div class="mb-8 grid gap-8 xl:grid-cols-[1.5fr,1fr]">
				<section>
					<h2 class="mb-4 text-xl font-serif text-sophia-dark-text">Knowledge Base Sources</h2>
					<div class="overflow-hidden rounded border border-sophia-dark-border bg-sophia-dark-surface">
						<table class="w-full">
							<thead class="border-b border-sophia-dark-border bg-sophia-dark-surface-raised">
								<tr>
									<th
										class="cursor-pointer px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted hover:text-sophia-dark-text"
										onclick={() => toggleSort('title')}
									>
										Title {sortColumn === 'title' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
									</th>
									<th
										class="cursor-pointer px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted hover:text-sophia-dark-text"
										onclick={() => toggleSort('source_type')}
									>
										Type {sortColumn === 'source_type' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
									</th>
									<th
										class="cursor-pointer px-4 py-3 text-right text-xs font-mono text-sophia-dark-muted hover:text-sophia-dark-text"
										onclick={() => toggleSort('claim_count')}
									>
										Claims {sortColumn === 'claim_count' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
									</th>
									<th
										class="cursor-pointer px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted hover:text-sophia-dark-text"
										onclick={() => toggleSort('status')}
									>
										Status {sortColumn === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
									</th>
									<th
										class="cursor-pointer px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted hover:text-sophia-dark-text"
										onclick={() => toggleSort('ingested_at')}
									>
										Ingested {sortColumn === 'ingested_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
									</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedSources as source}
									<tr class="border-b border-sophia-dark-border last:border-0 hover:bg-sophia-dark-surface-raised/50">
										<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{source.title}</td>
										<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">{source.source_type}</td>
										<td class="px-4 py-3 text-right font-mono text-sm text-sophia-dark-text">
											{source.claim_count ?? 0}
										</td>
										<td class="px-4 py-3">
											<span class={`rounded border px-2 py-1 text-xs font-mono ${getBadgeColor(source.status ?? 'pending')}`}>
												{source.status ?? 'pending'}
											</span>
										</td>
										<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">
											{formatDate(source.ingested_at)}
										</td>
									</tr>
								{:else}
									<tr>
										<td colspan="5" class="px-4 py-8 text-center font-mono text-sm text-sophia-dark-muted">
											No sources ingested yet.
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>

				<div class="space-y-8">
					<section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<div class="mb-1 text-xs font-mono text-sophia-dark-muted">Average Validation Score</div>
						<div class="text-2xl font-mono text-sophia-dark-blue">
							{dashboard.averageValidationScore !== null
								? dashboard.averageValidationScore.toFixed(2)
								: '—'}
						</div>
					</section>

					<section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<h2 class="mb-4 text-xl font-serif text-sophia-dark-text">Domain Distribution</h2>
						<div class="space-y-3">
							{#each dashboard.domainDistribution as domain}
								<div>
									<div class="mb-1 flex items-center justify-between">
										<span class="font-mono text-sm text-sophia-dark-text">{domain.domain}</span>
										<span class="font-mono text-sm text-sophia-dark-muted">{domain.count}</span>
									</div>
									<div class="h-2 overflow-hidden rounded-full bg-sophia-dark-surface-raised">
										<div
											class="h-full rounded-full bg-sophia-dark-sage"
											style={`width: ${(domain.count / maxDomainCount) * 100}%`}
										></div>
									</div>
								</div>
							{:else}
								<p class="py-4 text-center font-mono text-sm text-sophia-dark-muted">
									No domain data available.
								</p>
							{/each}
						</div>
					</section>

					<section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<h2 class="mb-4 text-xl font-serif text-sophia-dark-text">Relation Distribution</h2>
						<div class="space-y-3">
							{#each dashboard.relationDistribution as relation}
								<div>
									<div class="mb-1 flex items-center justify-between">
										<span class="font-mono text-sm text-sophia-dark-text">{relation.type}</span>
										<span class="font-mono text-sm text-sophia-dark-muted">{relation.count}</span>
									</div>
									<div class="h-2 overflow-hidden rounded-full bg-sophia-dark-surface-raised">
										<div
											class="h-full rounded-full bg-sophia-dark-blue"
											style={`width: ${(relation.count / maxRelationCount) * 100}%`}
										></div>
									</div>
								</div>
							{/each}
						</div>
					</section>
				</div>
			</div>

			<section class="mb-8">
				<h2 class="mb-4 text-xl font-serif text-sophia-dark-text">Recent Ingestion Activity</h2>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface">
					{#if dashboard.recentIngestions.length > 0}
						<div class="divide-y divide-sophia-dark-border">
							{#each dashboard.recentIngestions as source}
								<div class="px-4 py-3 hover:bg-sophia-dark-surface-raised/50">
									<div class="flex items-start justify-between gap-4">
										<div>
											<div class="font-mono text-sm text-sophia-dark-text">{source.title}</div>
											<div class="mt-1 font-mono text-xs text-sophia-dark-muted">{source.source_type}</div>
										</div>
										<div class="text-right">
											<div class="font-mono text-xs text-sophia-dark-muted">
												{formatDate(source.ingested_at)}
											</div>
											<div class="mt-1">
												<span class={`rounded border px-2 py-1 text-xs font-mono ${getBadgeColor(source.status ?? 'pending')}`}>
													{source.status ?? 'pending'}
												</span>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="px-4 py-8 text-center font-mono text-sm text-sophia-dark-muted">
							No recent ingestions recorded.
						</p>
					{/if}
				</div>
			</section>

			<section id="api-keys">
				<div class="mb-4 flex items-end justify-between gap-4">
					<div>
						<h2 class="text-xl font-serif text-sophia-dark-text">API Keys</h2>
						<p class="text-sm text-sophia-dark-muted">
							Issue access from the admin hub without dropping to scripts or the terminal.
						</p>
					</div>
				</div>

				<div class="mb-4 rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="grid gap-3 lg:grid-cols-[1.4fr,1.2fr,0.7fr,auto]">
						<input
							bind:value={keyName}
							placeholder="Key name"
							class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
						/>
						<input
							bind:value={keyOwnerUid}
							placeholder="Owner UID"
							class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
						/>
						<input
							bind:value={keyDailyQuota}
							type="number"
							min="1"
							class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
						/>
						<button
							type="button"
							class="rounded border border-sophia-dark-sage px-4 py-2 font-mono text-sm text-sophia-dark-sage transition-colors hover:bg-sophia-dark-sage/10 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={requestState === 'submitting'}
							onclick={generateKey}
						>
							{requestState === 'submitting' ? 'Creating...' : 'Generate New Key'}
						</button>
					</div>
				</div>

				<div class="overflow-hidden rounded border border-sophia-dark-border bg-sophia-dark-surface">
					<table class="w-full">
						<thead class="border-b border-sophia-dark-border bg-sophia-dark-surface-raised">
							<tr>
								<th class="px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted">Name</th>
								<th class="px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted">Owner</th>
								<th class="px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted">Prefix</th>
								<th class="px-4 py-3 text-right text-xs font-mono text-sophia-dark-muted">Usage</th>
								<th class="px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted">Created</th>
								<th class="px-4 py-3 text-left text-xs font-mono text-sophia-dark-muted">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each dashboard.apiKeys as key}
								<tr class="border-b border-sophia-dark-border last:border-0 hover:bg-sophia-dark-surface-raised/50">
									<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{key.name}</td>
									<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">{key.owner_uid}</td>
									<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{key.key_prefix}</td>
									<td class="px-4 py-3 text-right font-mono text-sm text-sophia-dark-text">
										{key.usage_count}
									</td>
									<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">
										{formatDate(key.created_at)}
									</td>
									<td class="px-4 py-3">
										<span class={`rounded border px-2 py-1 text-xs font-mono ${key.active
											? 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40'
											: 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40'}`}>
											{key.active ? 'active' : 'revoked'}
										</span>
									</td>
								</tr>
							{:else}
								<tr>
									<td colspan="6" class="px-4 py-8 text-center font-mono text-sm text-sophia-dark-muted">
										No API keys generated yet.
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>
</div>
