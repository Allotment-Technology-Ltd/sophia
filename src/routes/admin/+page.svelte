<script lang="ts">
	import type { PageData } from './$types';
	import type { ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	// Table sorting state
	let sortColumn: 'title' | 'source_type' | 'claim_count' | 'status' | 'ingested_at' = $state('ingested_at');
	let sortDirection: 'asc' | 'desc' = $state('desc');

	// Calculate sorted sources
	let sortedSources = $derived(() => {
		const sources = [...data.sources];
		sources.sort((a, b) => {
			let aVal = a[sortColumn];
			let bVal = b[sortColumn];
			
			// Handle null/undefined
			if (aVal === null || aVal === undefined) return 1;
			if (bVal === null || bVal === undefined) return -1;
			
			// Compare
			if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
			if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
			return 0;
		});
		return sources;
	});

	function toggleSort(column: typeof sortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'desc';
		}
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { 
			month: 'short', 
			day: 'numeric', 
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getBadgeColor(status: string): string {
		switch (status) {
			case 'ingested': return 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40';
			case 'validated': return 'bg-sophia-dark-blue/20 text-sophia-dark-blue border-sophia-dark-blue/40';
			case 'quarantined': return 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40';
			default: return 'bg-sophia-dark-surface-raised text-sophia-dark-dim border-sophia-dark-border';
		}
	}

	// Calculate max values for bar charts
	let maxDomainCount = $derived(Math.max(...data.domainDistribution.map(d => d.count), 1));
	let maxRelationCount = $derived(Math.max(...data.relationDistribution.map(r => r.count), 1));
</script>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
	<div class="max-w-7xl mx-auto px-6 py-8">
		<!-- Header -->
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-serif text-sophia-dark-text mb-1">SOPHIA Admin</h1>
				<p class="text-sophia-dark-muted font-mono text-sm">Knowledge Base Dashboard</p>
			</div>
			<a 
				href="/" 
				class="px-4 py-2 bg-sophia-dark-surface-raised border border-sophia-dark-border rounded hover:bg-sophia-dark-surface transition-colors font-mono text-sm"
			>
				← Back to App
			</a>
		</div>

		{#if data.error}
			<div class="mb-6 p-4 bg-sophia-dark-copper/20 border border-sophia-dark-copper/40 rounded text-sophia-dark-copper">
				<p class="font-mono text-sm">Error loading dashboard: {data.error}</p>
			</div>
		{/if}

		<!-- Stats Cards -->
		<div class="grid grid-cols-4 gap-4 mb-8">
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				<div class="text-sophia-dark-muted text-xs font-mono mb-1">SOURCES</div>
				<div class="text-3xl font-mono text-sophia-dark-text">{data.stats.sources}</div>
			</div>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				<div class="text-sophia-dark-muted text-xs font-mono mb-1">CLAIMS</div>
				<div class="text-3xl font-mono text-sophia-dark-text">{data.stats.claims}</div>
			</div>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				<div class="text-sophia-dark-muted text-xs font-mono mb-1">ARGUMENTS</div>
				<div class="text-3xl font-mono text-sophia-dark-text">{data.stats.arguments}</div>
			</div>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				<div class="text-sophia-dark-muted text-xs font-mono mb-1">RELATIONS</div>
				<div class="text-3xl font-mono text-sophia-dark-text">{data.stats.relations}</div>
			</div>
		</div>

		<!-- Avg Validation Score -->
		{#if data.averageValidationScore !== null}
			<div class="mb-8 p-4 bg-sophia-dark-surface border border-sophia-dark-border rounded">
				<div class="text-sophia-dark-muted text-xs font-mono mb-1">AVG VALIDATION SCORE</div>
				<div class="text-2xl font-mono text-sophia-dark-blue">{data.averageValidationScore.toFixed(2)}</div>
			</div>
		{/if}

		<!-- Sources Table -->
		<div class="mb-8">
			<h2 class="text-xl font-serif text-sophia-dark-text mb-4">Sources</h2>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded overflow-hidden">
				<table class="w-full">
					<thead class="bg-sophia-dark-surface-raised border-b border-sophia-dark-border">
						<tr>
							<th 
								class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted cursor-pointer hover:text-sophia-dark-text transition-colors"
								onclick={() => toggleSort('title')}
							>
								TITLE {sortColumn === 'title' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
							</th>
							<th 
								class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted cursor-pointer hover:text-sophia-dark-text transition-colors"
								onclick={() => toggleSort('source_type')}
							>
								TYPE {sortColumn === 'source_type' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
							</th>
							<th 
								class="text-right px-4 py-3 text-xs font-mono text-sophia-dark-muted cursor-pointer hover:text-sophia-dark-text transition-colors"
								onclick={() => toggleSort('claim_count')}
							>
								CLAIMS {sortColumn === 'claim_count' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
							</th>
							<th 
								class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted cursor-pointer hover:text-sophia-dark-text transition-colors"
								onclick={() => toggleSort('status')}
							>
								STATUS {sortColumn === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
							</th>
							<th 
								class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted cursor-pointer hover:text-sophia-dark-text transition-colors"
								onclick={() => toggleSort('ingested_at')}
							>
								INGESTED {sortColumn === 'ingested_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
							</th>
						</tr>
					</thead>
					<tbody>
						{#each sortedSources() as source}
							<tr class="border-b border-sophia-dark-border last:border-0 hover:bg-sophia-dark-surface-raised/50 transition-colors">
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{source.title}</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">{source.source_type}</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text text-right">{source.claim_count ?? 0}</td>
								<td class="px-4 py-3">
									<span class="px-2 py-1 text-xs font-mono border rounded {getBadgeColor(source.status ?? 'pending')}">
										{source.status ?? 'pending'}
									</span>
								</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">{formatDate(source.ingested_at)}</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="px-4 py-8 text-center text-sophia-dark-dim font-mono text-sm">
									No sources ingested yet
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Domain Distribution -->
		<div class="mb-8">
			<h2 class="text-xl font-serif text-sophia-dark-text mb-4">Domain Distribution</h2>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				{#if data.domainDistribution.length > 0}
					<div class="space-y-3">
						{#each data.domainDistribution as domain}
							<div>
								<div class="flex justify-between items-center mb-1">
									<span class="font-mono text-sm text-sophia-dark-text">{domain.domain}</span>
									<span class="font-mono text-sm text-sophia-dark-muted">{domain.count}</span>
								</div>
								<div class="h-2 bg-sophia-dark-surface-raised rounded-full overflow-hidden">
									<div 
										class="h-full bg-sophia-dark-sage rounded-full transition-all"
										style="width: {(domain.count / maxDomainCount) * 100}%"
									></div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sophia-dark-dim font-mono text-sm text-center py-4">No domain data available</p>
				{/if}
			</div>
		</div>

		<!-- Relation Distribution -->
		<div class="mb-8">
			<h2 class="text-xl font-serif text-sophia-dark-text mb-4">Relation Distribution</h2>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				{#if data.relationDistribution.length > 0}
					<div class="space-y-3">
						{#each data.relationDistribution as relation}
							<div>
								<div class="flex justify-between items-center mb-1">
									<span class="font-mono text-sm text-sophia-dark-text">{relation.type}</span>
									<span class="font-mono text-sm text-sophia-dark-muted">{relation.count}</span>
								</div>
								<div class="h-2 bg-sophia-dark-surface-raised rounded-full overflow-hidden">
									<div 
										class="h-full bg-sophia-dark-blue rounded-full transition-all"
										style="width: {(relation.count / maxRelationCount) * 100}%"
									></div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sophia-dark-dim font-mono text-sm text-center py-4">No relation data available</p>
				{/if}
			</div>
		</div>

		<!-- Recent Activity -->
		<div class="mb-8">
			<h2 class="text-xl font-serif text-sophia-dark-text mb-4">Recent Activity</h2>
			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded">
				{#if data.recentIngestions.length > 0}
					<div class="divide-y divide-sophia-dark-border">
						{#each data.recentIngestions as source}
							<div class="px-4 py-3 hover:bg-sophia-dark-surface-raised/50 transition-colors">
								<div class="flex justify-between items-start">
									<div>
										<div class="font-mono text-sm text-sophia-dark-text">{source.title}</div>
										<div class="font-mono text-xs text-sophia-dark-muted mt-1">{source.source_type}</div>
									</div>
									<div class="text-right">
										<div class="font-mono text-xs text-sophia-dark-dim">{formatDate(source.ingested_at)}</div>
										<div class="mt-1">
											<span class="px-2 py-0.5 text-xs font-mono border rounded {getBadgeColor(source.status ?? 'pending')}">
												{source.status ?? 'pending'}
											</span>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sophia-dark-dim font-mono text-sm text-center py-8">No recent ingestions</p>
				{/if}
			</div>
		</div>

		<!-- API Keys -->
		<div class="mb-8">
			<h2 class="text-xl font-serif text-sophia-dark-text mb-4">API Keys</h2>
			<div class="mb-4 bg-sophia-dark-surface border border-sophia-dark-border rounded p-4">
				<form method="POST" action="?/generateKey" class="grid grid-cols-4 gap-3">
					<input
						name="name"
						placeholder="Key name"
						class="col-span-2 rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
					/>
					<input
						name="owner_uid"
						placeholder="Owner UID"
						class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
					/>
					<input
						name="daily_quota"
						type="number"
						min="1"
						value="100"
						class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
					/>
					<button
						type="submit"
						class="col-span-4 rounded border border-sophia-dark-sage px-4 py-2 font-mono text-sm text-sophia-dark-sage hover:bg-sophia-dark-sage/10 transition-colors"
					>
						Generate New Key
					</button>
				</form>
				{#if form?.generatedKey}
					<p class="mt-3 font-mono text-xs text-sophia-dark-sage break-all">
						New key (shown once): {form.generatedKey}
					</p>
				{/if}
			</div>

			<div class="bg-sophia-dark-surface border border-sophia-dark-border rounded overflow-hidden">
				<table class="w-full">
					<thead class="bg-sophia-dark-surface-raised border-b border-sophia-dark-border">
						<tr>
							<th class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted">NAME</th>
							<th class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted">OWNER</th>
							<th class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted">PREFIX</th>
							<th class="text-right px-4 py-3 text-xs font-mono text-sophia-dark-muted">USAGE</th>
							<th class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted">CREATED</th>
							<th class="text-left px-4 py-3 text-xs font-mono text-sophia-dark-muted">STATUS</th>
						</tr>
					</thead>
					<tbody>
						{#each data.apiKeys as key}
							<tr class="border-b border-sophia-dark-border last:border-0 hover:bg-sophia-dark-surface-raised/50 transition-colors">
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{key.name}</td>
								<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">{key.owner_uid}</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{key.key_prefix}</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text text-right">{key.usage_count}</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-muted">{formatDate(key.created_at)}</td>
								<td class="px-4 py-3">
									<span class="px-2 py-1 text-xs font-mono border rounded {key.active ? 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40' : 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40'}">
										{key.active ? 'active' : 'revoked'}
									</span>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="6" class="px-4 py-8 text-center text-sophia-dark-dim font-mono text-sm">
									No API keys generated yet
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>
