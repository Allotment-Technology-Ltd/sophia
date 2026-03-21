<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { auth, getIdToken, onAuthChange } from '$lib/firebase';
	import { consumeAdminQuickStartParams } from '$lib/admin/quickStartGate';
	import type {
		DuplicateClassification,
		ReviewDashboardData
	} from '$lib/server/review/workflow';
	import type { ReviewDecisionState } from '$lib/server/review/adminReviewApi';

	let dashboard = $state<ReviewDashboardData | null>(null);
	let reviewStates = $state<ReviewDecisionState[]>([]);
	let duplicateClassifications = $state<DuplicateClassification[]>([]);
	let pageState = $state<'loading' | 'ready' | 'forbidden'>('loading');
	let currentUserEmail = $state<string | null>(null);
	let errorMessage = $state('');
	let successMessage = $state('');
	let claimNotes = $state<Record<string, string>>({});
	let relationNotes = $state<Record<string, string>>({});
	let duplicateNotes = $state<Record<string, string>>({});
	let duplicateSelection = $state<Record<string, DuplicateClassification>>({});
	let duplicateCanonical = $state<Record<string, string>>({});
	let activeRequest = $state<string | null>(null);

	function formatReviewState(state: string): string {
		return state.replace(/_/g, ' ');
	}

	function reviewStateClass(state: string): string {
		switch (state) {
			case 'accepted':
				return 'border-sophia-dark-blue/40 bg-sophia-dark-blue/15 text-sophia-dark-blue';
			case 'rejected':
				return 'border-sophia-dark-copper/40 bg-sophia-dark-copper/15 text-sophia-dark-copper';
			case 'merged':
				return 'border-sophia-dark-muted/40 bg-sophia-dark-muted/10 text-sophia-dark-muted';
			case 'needs_review':
				return 'border-sophia-dark-copper/30 bg-sophia-dark-copper/10 text-sophia-dark-text';
			default:
				return 'border-sophia-dark-sage/40 bg-sophia-dark-sage/15 text-sophia-dark-sage';
		}
	}

	function truncate(text: string, limit = 180): string {
		return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
	}

	function blockersCopy(blockers: string[]): string {
		if (blockers.length === 0) return 'Eligible for promotion.';
		return `Blocked: ${blockers.join(', ').replace(/_/g, ' ')}`;
	}

	function syncFormState(nextDashboard: ReviewDashboardData): void {
		const nextClaimNotes = { ...claimNotes };
		for (const claim of nextDashboard.claimQueue) {
			nextClaimNotes[claim.id] ??= claim.review_notes ?? '';
		}
		claimNotes = nextClaimNotes;

		const nextRelationNotes = { ...relationNotes };
		for (const relation of nextDashboard.relationQueue) {
			nextRelationNotes[relation.id] ??= relation.review_notes ?? relation.note ?? '';
		}
		relationNotes = nextRelationNotes;

		const nextDuplicateNotes = { ...duplicateNotes };
		const nextDuplicateSelection = { ...duplicateSelection };
		const nextDuplicateCanonical = { ...duplicateCanonical };
		for (const suggestion of nextDashboard.duplicateSuggestions) {
			nextDuplicateNotes[suggestion.pair_key] ??= '';
			nextDuplicateSelection[suggestion.pair_key] ??= suggestion.suggested_classification;
			nextDuplicateCanonical[suggestion.pair_key] ??= suggestion.recommended_canonical_claim_id;
		}
		duplicateNotes = nextDuplicateNotes;
		duplicateSelection = nextDuplicateSelection;
		duplicateCanonical = nextDuplicateCanonical;
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
		const body = await authorizedJson('/api/admin/review?limit=24');
		dashboard = body.dashboard ?? null;
		reviewStates = Array.isArray(body.reviewStates) ? body.reviewStates : [];
		duplicateClassifications = Array.isArray(body.duplicateClassifications)
			? body.duplicateClassifications
			: [];
		if (dashboard) {
			syncFormState(dashboard);
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
		pageState = body.is_admin ? 'ready' : 'forbidden';
		if (pageState === 'ready') {
			await refreshDashboard();
		}
	}

	async function submitClaimReview(claimId: string, nextState: ReviewDecisionState): Promise<void> {
		activeRequest = `claim:${claimId}:${nextState}`;
		errorMessage = '';
		successMessage = '';
		try {
			const body = await authorizedJson('/api/admin/review/claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					claim_id: claimId,
					next_state: nextState,
					notes: claimNotes[claimId] ?? ''
				})
			});
			successMessage = body.success ?? 'Claim updated.';
			await refreshDashboard();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to review claim';
		} finally {
			activeRequest = null;
		}
	}

	async function submitRelationReview(
		relationId: string,
		relationTable: string,
		nextState: ReviewDecisionState
	): Promise<void> {
		activeRequest = `relation:${relationId}:${nextState}`;
		errorMessage = '';
		successMessage = '';
		try {
			const body = await authorizedJson('/api/admin/review/relation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					relation_id: relationId,
					relation_table: relationTable,
					next_state: nextState,
					notes: relationNotes[relationId] ?? ''
				})
			});
			successMessage = body.success ?? 'Relation updated.';
			await refreshDashboard();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to review relation';
		} finally {
			activeRequest = null;
		}
	}

	async function submitDuplicateResolution(
		pairKey: string,
		leftClaimId: string,
		rightClaimId: string
	): Promise<void> {
		activeRequest = `duplicate:${pairKey}`;
		errorMessage = '';
		successMessage = '';
		try {
			const body = await authorizedJson('/api/admin/review/duplicate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					left_claim_id: leftClaimId,
					right_claim_id: rightClaimId,
					canonical_claim_id: duplicateCanonical[pairKey],
					classification: duplicateSelection[pairKey],
					notes: duplicateNotes[pairKey] ?? ''
				})
			});
			successMessage = body.success ?? 'Duplicate resolution recorded.';
			await refreshDashboard();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to resolve duplicate pair';
		} finally {
			activeRequest = null;
		}
	}

	onMount(() => {
		if (!browser) return;
		consumeAdminQuickStartParams();

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

<div class="admin-review min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
	<div class="admin-review-shell mx-auto w-full max-w-[76rem] px-6 py-8 sm:px-10 lg:px-14 xl:px-16">
		<div class="mb-8 flex items-start justify-between gap-4">
			<div>
				<h1 class="mb-1 text-3xl font-serif text-sophia-dark-text">Review Queue</h1>
				<p class="font-mono text-sm text-sophia-dark-muted">
					Trusted graph promotion, duplicate resolution, and audit history.
				</p>
			</div>
			<div class="flex gap-3">
				<a
					href="/admin"
					class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
				>
					Admin Hub
				</a>
				<a
					href="/admin/operations"
					class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
				>
					Operations
				</a>
			</div>
		</div>

		{#if pageState === 'loading'}
			<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 font-mono text-sm text-sophia-dark-muted">
				Loading review queue...
			</div>
		{:else if pageState === 'forbidden'}
			<div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-6">
				<h2 class="mb-2 text-lg font-serif text-sophia-dark-copper">Administrator access required</h2>
				<p class="font-mono text-sm text-sophia-dark-copper">
					{currentUserEmail ?? 'This account'} does not currently hold the `administrator` role.
				</p>
			</div>
		{:else if dashboard}
			{#if successMessage}
				<div class="mb-6 rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 p-4 font-mono text-sm text-sophia-dark-blue">
					{successMessage}
				</div>
			{/if}

			{#if errorMessage}
				<div class="mb-6 rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
					{errorMessage}
				</div>
			{/if}

			<div class="mb-8 grid gap-4 md:grid-cols-4">
				<a href="#duplicates" class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4 hover:bg-sophia-dark-surface-raised">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">DUPLICATES</div>
					<div class="text-xl font-mono text-sophia-dark-text">{dashboard.duplicateSuggestions.length}</div>
					<p class="mt-2 text-sm text-sophia-dark-muted">Resolve candidate duplicates and paraphrases.</p>
				</a>
				<a href="#claims" class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4 hover:bg-sophia-dark-surface-raised">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">CLAIMS</div>
					<div class="text-xl font-mono text-sophia-dark-text">{dashboard.claimQueue.length}</div>
					<p class="mt-2 text-sm text-sophia-dark-muted">Review source-grounded claims before promotion.</p>
				</a>
				<a href="#relations" class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4 hover:bg-sophia-dark-surface-raised">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">RELATIONS</div>
					<div class="text-xl font-mono text-sophia-dark-text">{dashboard.relationQueue.length}</div>
					<p class="mt-2 text-sm text-sophia-dark-muted">Confirm evidence-backed links between claims.</p>
				</a>
				<a href="#audit" class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4 hover:bg-sophia-dark-surface-raised">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">AUDIT</div>
					<div class="text-xl font-mono text-sophia-dark-text">{dashboard.recentAudit.length}</div>
					<p class="mt-2 text-sm text-sophia-dark-muted">Inspect the most recent moderation decisions.</p>
				</a>
			</div>

			<div class="mb-8 grid gap-4 md:grid-cols-3">
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">GRAPH MODE</div>
					<div class="text-xl font-mono text-sophia-dark-text">
						{dashboard.trustedGraphActive ? 'Trusted graph live' : 'Staging graph only'}
					</div>
					<p class="mt-2 text-sm text-sophia-dark-muted">
						Accepted claims can be queried separately from staging candidates.
					</p>
				</div>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">CLAIM STATES</div>
					<div class="grid grid-cols-2 gap-2 font-mono text-sm">
						<div>accepted</div>
						<div class="text-right">{dashboard.claimCounts.accepted}</div>
						<div>candidate</div>
						<div class="text-right">{dashboard.claimCounts.candidate}</div>
						<div>needs_review</div>
						<div class="text-right">{dashboard.claimCounts.needs_review}</div>
						<div>rejected</div>
						<div class="text-right">{dashboard.claimCounts.rejected}</div>
						<div>merged</div>
						<div class="text-right">{dashboard.claimCounts.merged}</div>
					</div>
				</div>
				<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
					<div class="mb-2 font-mono text-xs text-sophia-dark-muted">RELATION STATES</div>
					<div class="grid grid-cols-2 gap-2 font-mono text-sm">
						<div>accepted</div>
						<div class="text-right">{dashboard.relationCounts.accepted}</div>
						<div>candidate</div>
						<div class="text-right">{dashboard.relationCounts.candidate}</div>
						<div>needs_review</div>
						<div class="text-right">{dashboard.relationCounts.needs_review}</div>
						<div>rejected</div>
						<div class="text-right">{dashboard.relationCounts.rejected}</div>
						<div>merged</div>
						<div class="text-right">{dashboard.relationCounts.merged}</div>
					</div>
				</div>
			</div>

			<section id="duplicates" class="mb-10">
				<div class="mb-4 flex items-end justify-between">
					<div>
						<h2 class="text-xl font-serif text-sophia-dark-text">Duplicate Resolution</h2>
						<p class="text-sm text-sophia-dark-muted">
							Resolve exact duplicates, paraphrases, broader claims, and related-but-distinct pairs.
						</p>
					</div>
					<div class="font-mono text-xs text-sophia-dark-muted">
						{dashboard.duplicateSuggestions.length} suggestions
					</div>
				</div>

				<div class="space-y-4">
					{#each dashboard.duplicateSuggestions as suggestion}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
							<div class="mb-3 flex flex-wrap items-center gap-2">
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									{suggestion.left.source.title}
								</span>
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									score {suggestion.score.toFixed(2)}
								</span>
								<span class={`rounded border px-2 py-1 font-mono text-xs ${reviewStateClass('candidate')}`}>
									suggested {formatReviewState(suggestion.suggested_classification)}
								</span>
							</div>

							<div class="grid gap-4 lg:grid-cols-2">
								<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised p-3">
									<div class="mb-2 font-mono text-xs text-sophia-dark-muted">
										{suggestion.left.id} · pos {suggestion.left.position_in_source ?? '—'}
									</div>
									<p class="text-sm leading-6 text-sophia-dark-text">{truncate(suggestion.left.text)}</p>
								</div>
								<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised p-3">
									<div class="mb-2 font-mono text-xs text-sophia-dark-muted">
										{suggestion.right.id} · pos {suggestion.right.position_in_source ?? '—'}
									</div>
									<p class="text-sm leading-6 text-sophia-dark-text">{truncate(suggestion.right.text)}</p>
								</div>
							</div>

							<p class="mt-3 text-sm text-sophia-dark-muted">{suggestion.reason}</p>

							<div class="mt-4 grid gap-3 lg:grid-cols-[1.2fr,1.2fr,1fr,1.4fr,auto]">
								<label class="block">
									<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Classification</span>
									<select
										bind:value={duplicateSelection[suggestion.pair_key]}
										class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
									>
										{#each duplicateClassifications as classification}
											<option value={classification}>{formatReviewState(classification)}</option>
										{/each}
									</select>
								</label>

								<label class="block">
									<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Canonical Claim</span>
									<select
										bind:value={duplicateCanonical[suggestion.pair_key]}
										class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
									>
										<option value={suggestion.left.id}>Keep {suggestion.left.id}</option>
										<option value={suggestion.right.id}>Keep {suggestion.right.id}</option>
									</select>
								</label>

								<label class="block lg:col-span-2">
									<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Notes</span>
									<input
										bind:value={duplicateNotes[suggestion.pair_key]}
										class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
										placeholder="Why this pair should merge or remain distinct"
									/>
								</label>

								<div class="flex items-end">
									<button
										type="button"
										class="w-full rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
										disabled={activeRequest === `duplicate:${suggestion.pair_key}`}
										onclick={() => submitDuplicateResolution(suggestion.pair_key, suggestion.left.id, suggestion.right.id)}
									>
										{activeRequest === `duplicate:${suggestion.pair_key}` ? 'Saving...' : 'Record'}
									</button>
								</div>
							</div>
						</div>
					{:else}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 text-center font-mono text-sm text-sophia-dark-muted">
							No unresolved duplicate suggestions.
						</div>
					{/each}
				</div>
			</section>

			<section id="claims" class="mb-10">
				<div class="mb-4 flex items-end justify-between">
					<div>
						<h2 class="text-xl font-serif text-sophia-dark-text">Claim Queue</h2>
						<p class="text-sm text-sophia-dark-muted">
							Accept only source-grounded claims with intact provenance.
						</p>
					</div>
					<div class="font-mono text-xs text-sophia-dark-muted">
						{dashboard.claimQueue.length} visible
					</div>
				</div>

				<div class="space-y-4">
					{#each dashboard.claimQueue as claim}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
							<div class="mb-3 flex flex-wrap items-center gap-2">
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									{claim.source.title}
								</span>
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									{claim.claim_type}
								</span>
								<span class={`rounded border px-2 py-1 font-mono text-xs ${reviewStateClass(claim.review_state)}`}>
									{formatReviewState(claim.review_state)}
								</span>
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									conf {claim.confidence.toFixed(2)}
								</span>
							</div>

							<p class="text-sm leading-6 text-sophia-dark-text">{truncate(claim.text, 260)}</p>

							<div class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted md:grid-cols-3">
								<div>claim id: {claim.id}</div>
								<div>position: {claim.position_in_source ?? '—'}</div>
								<div>span: {claim.source_span_start ?? '—'}–{claim.source_span_end ?? '—'}</div>
							</div>

							<p class={`mt-3 text-sm ${claim.promotable ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}`}>
								{blockersCopy(claim.blockers)}
							</p>

							<div class="mt-4 grid gap-3 lg:grid-cols-[1fr,auto,auto,auto]">
								<input
									bind:value={claimNotes[claim.id]}
									class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
									placeholder="Reviewer notes"
								/>
								<button
									type="button"
									class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `claim:${claim.id}:accepted`}
									onclick={() => submitClaimReview(claim.id, 'accepted')}
								>
									{activeRequest === `claim:${claim.id}:accepted` ? 'Saving...' : 'Accept'}
								</button>
								<button
									type="button"
									class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `claim:${claim.id}:needs_review`}
									onclick={() => submitClaimReview(claim.id, 'needs_review')}
								>
									{activeRequest === `claim:${claim.id}:needs_review` ? 'Saving...' : 'Need Review'}
								</button>
								<button
									type="button"
									class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-sm text-sophia-dark-copper hover:bg-sophia-dark-copper/20 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `claim:${claim.id}:rejected`}
									onclick={() => submitClaimReview(claim.id, 'rejected')}
								>
									{activeRequest === `claim:${claim.id}:rejected` ? 'Saving...' : 'Reject'}
								</button>
							</div>
						</div>
					{:else}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 text-center font-mono text-sm text-sophia-dark-muted">
							No claims waiting in the visible queue.
						</div>
					{/each}
				</div>
			</section>

			<section id="relations" class="mb-10">
				<div class="mb-4 flex items-end justify-between">
					<div>
						<h2 class="text-xl font-serif text-sophia-dark-text">Relation Queue</h2>
						<p class="text-sm text-sophia-dark-muted">
							Accepted relations require evidence pointers and non-rejected endpoints.
						</p>
					</div>
					<div class="font-mono text-xs text-sophia-dark-muted">
						{dashboard.relationQueue.length} visible
					</div>
				</div>

				<div class="space-y-4">
					{#each dashboard.relationQueue as relation}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
							<div class="mb-3 flex flex-wrap items-center gap-2">
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									{relation.table}
								</span>
								<span class={`rounded border px-2 py-1 font-mono text-xs ${reviewStateClass(relation.review_state)}`}>
									{formatReviewState(relation.review_state)}
								</span>
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									conf {relation.relation_confidence?.toFixed(2) ?? '—'}
								</span>
								<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
									{relation.from_claim.source.title}
								</span>
							</div>

							<div class="grid gap-3 lg:grid-cols-2">
								<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised p-3">
									<div class="mb-2 font-mono text-xs text-sophia-dark-muted">from {relation.from_claim.id}</div>
									<p class="text-sm leading-6 text-sophia-dark-text">{truncate(relation.from_claim.text, 160)}</p>
								</div>
								<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised p-3">
									<div class="mb-2 font-mono text-xs text-sophia-dark-muted">to {relation.to_claim.id}</div>
									<p class="text-sm leading-6 text-sophia-dark-text">{truncate(relation.to_claim.text, 160)}</p>
								</div>
							</div>

							<p class="mt-3 text-sm text-sophia-dark-muted">{relation.note ?? 'No reviewer note yet.'}</p>
							<p class={`mt-2 text-sm ${relation.promotable ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}`}>
								{blockersCopy(relation.blockers)}
							</p>

							<div class="mt-4 grid gap-3 lg:grid-cols-[1fr,auto,auto,auto]">
								<input
									bind:value={relationNotes[relation.id]}
									class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
									placeholder="Reviewer notes"
								/>
								<button
									type="button"
									class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `relation:${relation.id}:accepted`}
									onclick={() => submitRelationReview(relation.id, relation.table, 'accepted')}
								>
									{activeRequest === `relation:${relation.id}:accepted` ? 'Saving...' : 'Accept'}
								</button>
								<button
									type="button"
									class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `relation:${relation.id}:needs_review`}
									onclick={() => submitRelationReview(relation.id, relation.table, 'needs_review')}
								>
									{activeRequest === `relation:${relation.id}:needs_review` ? 'Saving...' : 'Need Review'}
								</button>
								<button
									type="button"
									class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-sm text-sophia-dark-copper hover:bg-sophia-dark-copper/20 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={activeRequest === `relation:${relation.id}:rejected`}
									onclick={() => submitRelationReview(relation.id, relation.table, 'rejected')}
								>
									{activeRequest === `relation:${relation.id}:rejected` ? 'Saving...' : 'Reject'}
								</button>
							</div>
						</div>
					{:else}
						<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6 text-center font-mono text-sm text-sophia-dark-muted">
							No relations waiting in the visible queue.
						</div>
					{/each}
				</div>
			</section>

			<section id="audit">
				<div class="mb-4 flex items-end justify-between">
					<div>
						<h2 class="text-xl font-serif text-sophia-dark-text">Audit Trail</h2>
						<p class="text-sm text-sophia-dark-muted">
							Every moderation decision is logged with reviewer identity and state transition.
						</p>
					</div>
					<div class="font-mono text-xs text-sophia-dark-muted">
						{dashboard.recentAudit.length} recent entries
					</div>
				</div>

				<div class="overflow-hidden rounded border border-sophia-dark-border bg-sophia-dark-surface">
					<table class="w-full">
						<thead class="border-b border-sophia-dark-border bg-sophia-dark-surface-raised">
							<tr class="font-mono text-xs text-sophia-dark-muted">
								<th class="px-4 py-3 text-left">When</th>
								<th class="px-4 py-3 text-left">Action</th>
								<th class="px-4 py-3 text-left">Entity</th>
								<th class="px-4 py-3 text-left">State</th>
								<th class="px-4 py-3 text-left">Reviewer</th>
							</tr>
						</thead>
						<tbody>
							{#each dashboard.recentAudit as entry}
								<tr class="border-b border-sophia-dark-border last:border-0">
									<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">
										{new Date(entry.created_at).toLocaleString()}
									</td>
									<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">{entry.action}</td>
									<td class="px-4 py-3">
										<div class="font-mono text-xs text-sophia-dark-muted">{entry.entity_kind}</div>
										<div class="font-mono text-sm text-sophia-dark-text">{entry.entity_id}</div>
									</td>
									<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">
										{entry.previous_state ?? '—'} → {entry.next_state ?? '—'}
									</td>
									<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">
										{entry.reviewer_email ?? entry.reviewer_uid}
									</td>
								</tr>
							{:else}
								<tr>
									<td colspan="5" class="px-4 py-8 text-center font-mono text-sm text-sophia-dark-muted">
										No audit entries recorded yet.
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
