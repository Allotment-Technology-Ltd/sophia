<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { QuestDefinition } from '$lib/server/stoa/game/types.js';
	import type { StoaProgressState } from '$lib/types/stoa.js';
	import QuestCard from './QuestCard.svelte';

	interface Props {
		open: boolean;
		userId: string;
		onclose?: () => void;
	}

	let { open = $bindable(false), userId, onclose }: Props = $props();

	let progress = $state<StoaProgressState | null>(null);
	let questDefinitions = $state<Map<string, QuestDefinition>>(new Map());
	let loading = $state(false);
	let error = $state<string | null>(null);
	let questCompletions = $state<Map<string, { completedAt: string; xpAwarded: number }>>(new Map());

	// Derived state for quest categorization
	let activeQuests = $derived(
		progress?.activeQuestIds
			?.map((id) => questDefinitions.get(id))
			.filter((q): q is QuestDefinition => q !== undefined) ?? []
	);

	let completedQuestIds = $derived(new Set(progress?.completedQuestIds ?? []));
	let activeQuestIds = $derived(new Set(progress?.activeQuestIds ?? []));

	let availableQuests = $derived(
		Array.from(questDefinitions.values()).filter(
			(q) => !completedQuestIds.has(q.id) && !activeQuestIds.has(q.id) && !isQuestLocked(q)
		)
	);

	interface CompletedQuestEntry {
		quest: QuestDefinition;
		completion: { completedAt: string; xpAwarded: number } | undefined;
	}

	let completedQuests = $derived(
		progress?.completedQuestIds
			?.map((id): CompletedQuestEntry | null => {
				const quest = questDefinitions.get(id);
				const completion = questCompletions.get(id);
				return quest ? { quest, completion } : null;
			})
			.filter((q): q is CompletedQuestEntry => q !== null) ?? []
	);

	let lockedQuests = $derived(
		Array.from(questDefinitions.values()).filter(
			(q) => !completedQuestIds.has(q.id) && !activeQuestIds.has(q.id) && isQuestLocked(q)
		)
	);

	function isQuestLocked(quest: QuestDefinition): boolean {
		// A quest is locked if its trigger requires a thinker that isn't unlocked yet
		if (quest.trigger.type === 'thinker_unlocked') {
			const unlocked = progress?.unlockedThinkers ?? ['marcus'];
			return !unlocked.includes(quest.trigger.thinkerId);
		}
		return false;
	}

	async function loadQuestDefinitions(): Promise<void> {
		try {
			const response = await fetch('/api/stoa/curriculum');
			if (!response.ok) {
				// Fallback: we won't have quest definitions, but we can still show basic info
				return;
			}
			const data = await response.json();
			if (data.quests && Array.isArray(data.quests)) {
				const map = new Map<string, QuestDefinition>();
				for (const quest of data.quests) {
					map.set(quest.id, quest);
				}
				questDefinitions = map;
			}
		} catch {
			// Silently fail - we'll show what we can from progress alone
		}
	}

	async function loadProgress(): Promise<void> {
		if (!userId) return;

		loading = true;
		error = null;

		try {
			const [progressResponse, completionsResponse] = await Promise.all([
				fetch('/api/stoa/progress'),
				fetch('/api/stoa/quest-completions').catch(() => null) // This endpoint may not exist yet
			]);

			if (!progressResponse.ok) {
				throw new Error(`Failed to load progress: ${progressResponse.status}`);
			}

			const progressData = await progressResponse.json();
			progress = progressData as StoaProgressState;

			// Load quest definitions if not already loaded
			if (questDefinitions.size === 0) {
				await loadQuestDefinitions();
			}

			// Load completion details if available
			if (completionsResponse?.ok) {
				const completions = await completionsResponse.json();
				if (completions && Array.isArray(completions)) {
					const map = new Map<string, { completedAt: string; xpAwarded: number }>();
					for (const c of completions) {
						map.set(c.quest_id, {
							completedAt: c.completed_at,
							xpAwarded: c.xp_awarded
						});
					}
					questCompletions = map;
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load progress';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			onclose?.();
		}
	}

	function handleClose(): void {
		onclose?.();
	}

	// Load data when opening
	$effect(() => {
		if (open && !progress) {
			void loadProgress();
		}
	});

	// Prevent body scroll when open
	$effect(() => {
		if (typeof document !== 'undefined') {
			if (open) {
				document.body.style.overflow = 'hidden';
			} else {
				document.body.style.overflow = '';
			}
		}
		return () => {
			if (typeof document !== 'undefined') {
				document.body.style.overflow = '';
			}
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="quest-journal-overlay"
		transition:fade={{ duration: 300 }}
		onclick={handleClose}
		onkeydown={(e) => e.key === 'Enter' && handleClose()}
		role="button"
		tabindex="0"
		aria-label="Close quest journal"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="quest-journal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<header class="journal-header">
				<h2 class="journal-title">Quest Journal</h2>
				<button class="close-button" onclick={handleClose} aria-label="Close journal">×</button>
			</header>

			{#if loading}
				<div class="loading-state">
					<p>Loading your progress...</p>
				</div>
			{:else if error}
				<div class="error-state">
					<p>{error}</p>
					<button class="retry-button" onclick={() => loadProgress()}>Retry</button>
				</div>
			{:else}
				<div class="journal-content">
					{#if activeQuests.length > 0}
						<section class="quest-section">
							<h3 class="section-title active">Active Quests</h3>
							<div class="quest-list">
								{#each activeQuests as quest (quest.id)}
									<QuestCard {quest} status="active" />
								{/each}
							</div>
						</section>
					{/if}

					{#if availableQuests.length > 0}
						<section class="quest-section">
							<h3 class="section-title available">Available Quests</h3>
							<div class="quest-list">
								{#each availableQuests as quest (quest.id)}
									<QuestCard {quest} status="available" />
								{/each}
							</div>
						</section>
					{/if}

					{#if completedQuests.length > 0}
						<section class="quest-section">
							<h3 class="section-title completed">Completed Quests</h3>
							<div class="quest-list">
								{#each completedQuests as { quest, completion } (quest.id)}
									<QuestCard
										{quest}
										status="completed"
										completedAt={completion?.completedAt}
										xpAwarded={completion?.xpAwarded}
									/>
								{/each}
							</div>
						</section>
					{/if}

					{#if lockedQuests.length > 0}
						<section class="quest-section">
							<h3 class="section-title locked">Locked Quests</h3>
							<div class="quest-list">
								{#each lockedQuests.slice(0, 3) as quest (quest.id)}
									<QuestCard {quest} status="locked" />
								{/each}
								{#if lockedQuests.length > 3}
									<p class="more-locked">+{lockedQuests.length - 3} more locked</p>
								{/if}
							</div>
						</section>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.quest-journal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: rgba(20, 18, 16, 0.95);
		backdrop-filter: blur(4px);
	}

	.quest-journal {
		width: 100%;
		max-width: 680px;
		max-height: 85vh;
		border-radius: 14px;
		border: 1px solid rgba(140, 130, 120, 0.3);
		background: rgba(26, 24, 22, 0.98);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.journal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 20px 24px;
		border-bottom: 1px solid rgba(140, 130, 120, 0.2);
	}

	.journal-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 500;
		color: rgba(239, 229, 208, 0.95);
		letter-spacing: 0.01em;
	}

	.close-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: 1px solid rgba(140, 130, 120, 0.3);
		background: rgba(40, 36, 32, 0.6);
		color: rgba(200, 190, 175, 0.8);
		font-size: 20px;
		font-weight: 400;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.close-button:hover {
		background: rgba(60, 54, 48, 0.8);
		color: rgba(239, 229, 208, 0.95);
	}

	.loading-state,
	.error-state {
		padding: 40px 24px;
		text-align: center;
		font-family: var(--font-body);
		color: rgba(200, 190, 175, 0.8);
	}

	.error-state {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.retry-button {
		align-self: center;
		padding: 8px 16px;
		border-radius: 6px;
		border: 1px solid rgba(140, 130, 120, 0.4);
		background: rgba(40, 36, 32, 0.6);
		color: rgba(200, 190, 175, 0.9);
		font-family: var(--font-ui);
		font-size: 12px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.retry-button:hover {
		background: rgba(60, 54, 48, 0.8);
	}

	.journal-content {
		flex: 1;
		overflow-y: auto;
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}

	.quest-section {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.section-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(180, 170, 160, 0.7);
		padding-bottom: 6px;
		border-bottom: 1px solid rgba(140, 130, 120, 0.15);
	}

	.section-title.active {
		color: rgba(190, 140, 80, 0.9);
		border-bottom-color: rgba(190, 140, 80, 0.3);
	}

	.section-title.available {
		color: rgba(140, 160, 180, 0.85);
		border-bottom-color: rgba(140, 160, 180, 0.25);
	}

	.section-title.completed {
		color: rgba(140, 180, 140, 0.8);
		border-bottom-color: rgba(140, 180, 140, 0.2);
	}

	.section-title.locked {
		color: rgba(120, 120, 120, 0.6);
		border-bottom-color: rgba(100, 100, 100, 0.15);
	}

	.quest-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.more-locked {
		margin: 0;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 12px;
		font-style: italic;
		color: rgba(120, 120, 120, 0.5);
	}

	@media (max-width: 640px) {
		.quest-journal-overlay {
			padding: 12px;
		}

		.quest-journal {
			max-height: 92vh;
		}

		.journal-header {
			padding: 16px 20px;
		}

		.journal-title {
			font-size: 18px;
		}

		.journal-content {
			padding: 16px 20px;
		}
	}
</style>
