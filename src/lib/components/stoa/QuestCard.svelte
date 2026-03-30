<script lang="ts">
	import type { QuestDefinition } from '$lib/server/stoa/game/quest-definitions/types.js';

	interface Props {
		quest: QuestDefinition;
		status: 'active' | 'available' | 'completed' | 'locked';
		completedAt?: string;
		xpAwarded?: number;
	}

	let { quest, status, completedAt, xpAwarded }: Props = $props();

	const levelNames: Record<number, string> = {
		1: 'The Questioner',
		2: 'The Practitioner',
		3: 'The Student',
		4: 'The Adept',
		5: 'The Philosopher',
		6: 'The Sage'
	};

	function formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="quest-card" data-status={status}>
	{#if status === 'locked'}
		<div class="quest-header">
			<h3 class="quest-title locked">···</h3>
		</div>
		<div class="quest-body locked">
			<p class="quest-description">Complete earlier quests to unlock this path.</p>
		</div>
	{:else}
		<div class="quest-header">
			<h3 class="quest-title">{quest.title}</h3>
			{#if status === 'completed'}
				<span class="checkmark">✓</span>
			{/if}
		</div>

		<div class="quest-body">
			{#if status === 'active'}
				<p class="quest-description">{quest.description ?? 'No description available.'}</p>
				{#if quest.framework}
					<div class="quest-frameworks">
						{#if Array.isArray(quest.framework)}
							{#each quest.framework as fw}
								<span class="framework-tag">{fw.replace(/_/g, ' ')}</span>
							{/each}
						{:else}
							<span class="framework-tag">{quest.framework.replace(/_/g, ' ')}</span>
						{/if}
					</div>
				{/if}
			{:else if status === 'available'}
				{#if quest.dialogueSeed}
					<blockquote class="quest-seed">"{quest.dialogueSeed}"</blockquote>
				{:else}
					<p class="quest-description">{quest.description ?? 'Speak with the Stoa to begin this quest.'}</p>
				{/if}
			{:else if status === 'completed'}
				<p class="quest-description dimmed">{quest.description ?? 'Quest completed.'}</p>
				<div class="completion-meta">
					<span class="completion-date">{formatDate(completedAt ?? '')}</span>
					{#if xpAwarded}
						<span class="xp-awarded">+{xpAwarded} XP</span>
					{:else if quest.reward?.xp}
						<span class="xp-awarded">+{quest.reward.xp} XP</span>
					{/if}
				</div>
			{/if}
		</div>

		{#if status === 'active' && quest.reward}
			<div class="quest-footer">
				<span class="reward">Reward: {quest.reward.xp} XP</span>
				{#if quest.reward.unlockThinkerId}
					<span class="unlock">Unlocks: {quest.reward.unlockThinkerId}</span>
				{/if}
				{#if quest.reward.unlockZone}
					<span class="unlock">Unlocks zone: {quest.reward.unlockZone}</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.quest-card {
		border-radius: 10px;
		padding: 16px 20px;
		background: rgba(30, 28, 26, 0.8);
		transition: all 200ms ease;
	}

	.quest-card[data-status='active'] {
		border: 1px solid rgba(190, 140, 80, 0.6);
		box-shadow: 0 0 20px rgba(190, 140, 80, 0.1);
	}

	.quest-card[data-status='available'] {
		border: 1px solid rgba(140, 130, 120, 0.4);
	}

	.quest-card[data-status='completed'] {
		border: 1px solid rgba(100, 100, 100, 0.3);
		opacity: 0.85;
	}

	.quest-card[data-status='locked'] {
		border: 1px solid rgba(80, 80, 80, 0.3);
		opacity: 0.6;
	}

	.quest-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
	}

	.quest-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 500;
		color: rgba(239, 229, 208, 0.95);
		letter-spacing: 0.01em;
	}

	.quest-title.locked {
		color: rgba(140, 130, 120, 0.6);
		font-style: italic;
	}

	.checkmark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: rgba(120, 160, 100, 0.3);
		color: rgba(140, 200, 120, 0.9);
		font-size: 12px;
		font-weight: 600;
	}

	.quest-body {
		display: grid;
		gap: 10px;
	}

	.quest-body.locked {
		opacity: 0.5;
	}

	.quest-description {
		margin: 0;
		font-family: var(--font-body);
		font-size: 14px;
		line-height: 1.5;
		color: rgba(220, 210, 190, 0.85);
	}

	.quest-description.dimmed {
		color: rgba(180, 170, 160, 0.7);
	}

	.quest-seed {
		margin: 0;
		padding: 10px 14px;
		border-left: 2px solid rgba(140, 130, 120, 0.5);
		font-family: var(--font-display);
		font-size: 14px;
		font-style: italic;
		line-height: 1.5;
		color: rgba(200, 185, 165, 0.8);
		background: rgba(20, 18, 16, 0.4);
		border-radius: 0 6px 6px 0;
	}

	.quest-frameworks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.framework-tag {
		padding: 3px 8px;
		border-radius: 4px;
		background: rgba(140, 120, 100, 0.2);
		font-family: var(--font-ui);
		font-size: 11px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: rgba(190, 170, 145, 0.8);
	}

	.completion-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding-top: 8px;
		border-top: 1px solid rgba(100, 100, 100, 0.2);
		font-family: var(--font-ui);
		font-size: 12px;
	}

	.completion-date {
		color: rgba(150, 140, 130, 0.7);
	}

	.xp-awarded {
		color: rgba(140, 200, 120, 0.85);
		font-weight: 500;
	}

	.quest-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding-top: 10px;
		margin-top: 10px;
		border-top: 1px solid rgba(140, 130, 120, 0.2);
		font-family: var(--font-ui);
		font-size: 12px;
	}

	.reward {
		color: rgba(190, 160, 120, 0.85);
	}

	.unlock {
		color: rgba(140, 180, 160, 0.8);
	}
</style>
