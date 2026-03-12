<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

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
</script>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
	<div class="mx-auto max-w-7xl px-6 py-8">
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
					← Admin
				</a>
				<a
					href="/"
					class="rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-4 py-2 font-mono text-sm hover:bg-sophia-dark-surface"
				>
					App
				</a>
			</div>
		</div>

		{#if form?.success}
			<div class="mb-6 rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 p-4 font-mono text-sm text-sophia-dark-blue">
				{form.success}
			</div>
		{/if}

		{#if form?.error}
			<div class="mb-6 rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
				{form.error}
			</div>
		{/if}

		<div class="mb-8 grid gap-4 md:grid-cols-3">
			<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
				<div class="mb-2 font-mono text-xs text-sophia-dark-muted">GRAPH MODE</div>
				<div class="text-xl font-mono text-sophia-dark-text">
					{data.dashboard.trustedGraphActive ? 'Trusted graph live' : 'Staging graph only'}
				</div>
				<p class="mt-2 text-sm text-sophia-dark-muted">
					Once accepted claims exist, the trusted layer can be queried separately from staging candidates.
				</p>
			</div>
			<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
				<div class="mb-2 font-mono text-xs text-sophia-dark-muted">CLAIMS</div>
				<div class="grid grid-cols-2 gap-2 font-mono text-sm">
					<div>accepted</div>
					<div class="text-right">{data.dashboard.claimCounts.accepted}</div>
					<div>candidate</div>
					<div class="text-right">{data.dashboard.claimCounts.candidate}</div>
					<div>needs_review</div>
					<div class="text-right">{data.dashboard.claimCounts.needs_review}</div>
					<div>rejected</div>
					<div class="text-right">{data.dashboard.claimCounts.rejected}</div>
					<div>merged</div>
					<div class="text-right">{data.dashboard.claimCounts.merged}</div>
				</div>
			</div>
			<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
				<div class="mb-2 font-mono text-xs text-sophia-dark-muted">RELATIONS</div>
				<div class="grid grid-cols-2 gap-2 font-mono text-sm">
					<div>accepted</div>
					<div class="text-right">{data.dashboard.relationCounts.accepted}</div>
					<div>candidate</div>
					<div class="text-right">{data.dashboard.relationCounts.candidate}</div>
					<div>needs_review</div>
					<div class="text-right">{data.dashboard.relationCounts.needs_review}</div>
					<div>rejected</div>
					<div class="text-right">{data.dashboard.relationCounts.rejected}</div>
					<div>merged</div>
					<div class="text-right">{data.dashboard.relationCounts.merged}</div>
				</div>
			</div>
		</div>

		<section id="duplicates" class="mb-10">
			<div class="mb-4 flex items-end justify-between">
				<div>
					<h2 class="text-xl font-serif text-sophia-dark-text">Duplicate Resolution</h2>
					<p class="text-sm text-sophia-dark-muted">
						Pair review distinguishes exact duplicates, paraphrases, broader/narrower claims, and related-but-distinct claims.
					</p>
				</div>
				<div class="font-mono text-xs text-sophia-dark-muted">
					{data.dashboard.duplicateSuggestions.length} suggestions
				</div>
			</div>

			<div class="space-y-4">
				{#each data.dashboard.duplicateSuggestions as suggestion}
					<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<div class="mb-3 flex flex-wrap items-center gap-2">
							<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
								{suggestion.left.source.title}
							</span>
							<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
								score {suggestion.score.toFixed(2)}
							</span>
							<span class="rounded border px-2 py-1 font-mono text-xs {reviewStateClass('candidate')}">
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

						<form method="POST" action="?/resolveDuplicate" class="mt-4 grid gap-3 lg:grid-cols-[1.2fr,1.2fr,1fr,1.4fr,auto]">
							<input type="hidden" name="left_claim_id" value={suggestion.left.id} />
							<input type="hidden" name="right_claim_id" value={suggestion.right.id} />

							<label class="block">
								<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Classification</span>
								<select
									name="classification"
									class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
								>
									{#each data.duplicateClassifications as classification}
										<option
											value={classification}
											selected={classification === suggestion.suggested_classification}
										>
											{formatReviewState(classification)}
										</option>
									{/each}
								</select>
							</label>

							<label class="block">
								<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Canonical Claim</span>
								<select
									name="canonical_claim_id"
									class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
								>
									<option
										value={suggestion.left.id}
										selected={suggestion.recommended_canonical_claim_id === suggestion.left.id}
									>
										Keep {suggestion.left.id}
									</option>
									<option
										value={suggestion.right.id}
										selected={suggestion.recommended_canonical_claim_id === suggestion.right.id}
									>
										Keep {suggestion.right.id}
									</option>
								</select>
							</label>

							<label class="block lg:col-span-2">
								<span class="mb-1 block font-mono text-xs text-sophia-dark-muted">Notes</span>
								<input
									name="notes"
									class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
									placeholder="Why this pair should merge or remain distinct"
								/>
							</label>

							<div class="flex items-end">
								<button
									type="submit"
									class="w-full rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
								>
									Record
								</button>
							</div>
						</form>
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
						Accept only source-grounded claims with intact provenance. Rejected or merged claims stay out of the trusted graph.
					</p>
				</div>
				<div class="font-mono text-xs text-sophia-dark-muted">
					{data.dashboard.claimQueue.length} visible
				</div>
			</div>

			<div class="space-y-4">
				{#each data.dashboard.claimQueue as claim}
					<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<div class="mb-3 flex flex-wrap items-center gap-2">
							<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
								{claim.source.title}
							</span>
							<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
								{claim.claim_type}
							</span>
							<span class="rounded border px-2 py-1 font-mono text-xs {reviewStateClass(claim.review_state)}">
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

						<p class="mt-3 text-sm {claim.promotable ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}">
							{blockersCopy(claim.blockers)}
						</p>

						<form method="POST" action="?/reviewClaim" class="mt-4 grid gap-3 lg:grid-cols-[1fr,auto,auto,auto]">
							<input type="hidden" name="claim_id" value={claim.id} />
							<input
								name="notes"
								class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
								placeholder="Reviewer notes"
								value={claim.review_notes ?? ''}
							/>
							<button
								name="next_state"
								value="accepted"
								class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
							>
								Accept
							</button>
							<button
								name="next_state"
								value="needs_review"
								class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
							>
								Need Review
							</button>
							<button
								name="next_state"
								value="rejected"
								class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-sm text-sophia-dark-copper hover:bg-sophia-dark-copper/20"
							>
								Reject
							</button>
						</form>
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
					{data.dashboard.relationQueue.length} visible
				</div>
			</div>

			<div class="space-y-4">
				{#each data.dashboard.relationQueue as relation}
					<div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
						<div class="mb-3 flex flex-wrap items-center gap-2">
							<span class="rounded border border-sophia-dark-border px-2 py-1 font-mono text-xs text-sophia-dark-muted">
								{relation.table}
							</span>
							<span class="rounded border px-2 py-1 font-mono text-xs {reviewStateClass(relation.review_state)}">
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

						<p class="mt-3 text-sm text-sophia-dark-muted">
							{relation.note ?? 'No reviewer note yet.'}
						</p>
						<p class="mt-2 text-sm {relation.promotable ? 'text-sophia-dark-sage' : 'text-sophia-dark-copper'}">
							{blockersCopy(relation.blockers)}
						</p>

						<form method="POST" action="?/reviewRelation" class="mt-4 grid gap-3 lg:grid-cols-[1fr,auto,auto,auto]">
							<input type="hidden" name="relation_id" value={relation.id} />
							<input type="hidden" name="relation_table" value={relation.table} />
							<input
								name="notes"
								class="w-full rounded border border-sophia-dark-border bg-sophia-dark-surface-raised px-3 py-2 font-mono text-sm text-sophia-dark-text"
								placeholder="Reviewer notes"
								value={relation.review_notes ?? relation.note ?? ''}
							/>
							<button
								name="next_state"
								value="accepted"
								class="rounded border border-sophia-dark-blue/40 bg-sophia-dark-blue/10 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/20"
							>
								Accept
							</button>
							<button
								name="next_state"
								value="needs_review"
								class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
							>
								Need Review
							</button>
							<button
								name="next_state"
								value="rejected"
								class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-sm text-sophia-dark-copper hover:bg-sophia-dark-copper/20"
							>
								Reject
							</button>
						</form>
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
						Every moderation decision is logged with reviewer identity, state transition, and merge metadata.
					</p>
				</div>
				<div class="font-mono text-xs text-sophia-dark-muted">
					{data.dashboard.recentAudit.length} recent entries
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
						{#each data.dashboard.recentAudit as entry}
							<tr class="border-b border-sophia-dark-border last:border-0">
								<td class="px-4 py-3 font-mono text-xs text-sophia-dark-muted">
									{new Date(entry.created_at).toLocaleString()}
								</td>
								<td class="px-4 py-3 font-mono text-sm text-sophia-dark-text">
									{entry.action}
								</td>
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
	</div>
</div>
