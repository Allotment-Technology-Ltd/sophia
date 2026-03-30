/**
 * Quest engine - stateless evaluation of quest triggers and completions
 */

import { ALL_QUESTS, getQuestById } from './quest-definitions/index.js';
import type {
	QuestDefinition,
	QuestContext,
	QuestTrigger,
	QuestCompletion
} from './quest-definitions/types.js';
import {
	getProgress,
	addXp,
	unlockThinker,
	startQuest,
	completeQuest,
	isQuestCompleted,
	isQuestActive
} from './progress-store.js';

export interface QuestEvaluationResult {
	newlyAvailable: QuestDefinition[];
	newlyCompleted: QuestDefinition[];
	xpAwarded: number;
	unlocksAwarded: string[];
}

/**
 * Stateless quest engine for evaluating triggers and completions
 */
export class QuestEngine {
	/**
	 * Evaluate triggers to find newly available quests
	 */
	async evaluateTriggers(userId: string, context: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		const newlyAvailable: QuestDefinition[] = [];

		for (const quest of ALL_QUESTS) {
			// Skip if already active or completed
			if (progress.activeQuestIds.includes(quest.id)) continue;
			if (progress.completedQuestIds.includes(quest.id)) continue;

			// Check if trigger is satisfied
			if (this.isTriggerSatisfied(quest.trigger, context)) {
				newlyAvailable.push(quest);
				// Auto-start the quest
				await startQuest(userId, quest.id);
			}
		}

		return newlyAvailable;
	}

	/**
	 * Evaluate completions to find newly completed quests
	 */
	async evaluateCompletions(userId: string, context: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		const newlyCompleted: QuestDefinition[] = [];

		// Only evaluate active quests
		for (const questId of progress.activeQuestIds) {
			const quest = getQuestById(questId);
			if (!quest) continue;

			// Check if completion criteria is satisfied
			if (this.isCompletionSatisfied(quest.completion, context)) {
				newlyCompleted.push(quest);
			}
		}

		return newlyCompleted;
	}

	/**
	 * Award completion for a quest (idempotent)
	 */
	async awardCompletion(
		userId: string,
		quest: QuestDefinition,
		sessionId: string
	): Promise<void> {
		// Idempotency check: verify quest is not already completed
		const alreadyCompleted = await isQuestCompleted(userId, quest.id);
		if (alreadyCompleted) {
			console.log(`[QuestEngine] Quest ${quest.id} already completed for ${userId}, skipping`);
			return;
		}

		// Award XP
		if (quest.reward.xp > 0) {
			await addXp(userId, quest.reward.xp);
		}

		// Award thinker unlock if specified
		if (quest.reward.unlockThinkerId) {
			await unlockThinker(userId, quest.reward.unlockThinkerId);
		}

		// Mark quest as completed (this handles the idempotency record)
		await completeQuest(
			userId,
			quest.id,
			[sessionId],
			quest.reward.xp,
			quest.reward.unlockThinkerId
		);

		console.log(`[QuestEngine] Awarded quest ${quest.id} to ${userId}: ${quest.reward.xp} XP`);
	}

	/**
	 * Full evaluation: triggers + completions + awards
	 */
	async evaluate(
		userId: string,
		context: QuestContext
	): Promise<QuestEvaluationResult> {
		// First, check for newly available quests
		const newlyAvailable = await this.evaluateTriggers(userId, context);

		// Then, check for completed quests
		const newlyCompleted = await this.evaluateCompletions(userId, context);

		// Award completions
		let totalXp = 0;
		const unlocks: string[] = [];

		for (const quest of newlyCompleted) {
			await this.awardCompletion(userId, quest, context.sessionId);
			totalXp += quest.reward.xp;
			if (quest.reward.unlockThinkerId) {
				unlocks.push(quest.reward.unlockThinkerId);
			}
		}

		return {
			newlyAvailable,
			newlyCompleted,
			xpAwarded: totalXp,
			unlocksAwarded: unlocks
		};
	}

	/**
	 * Check if a trigger is satisfied given the context
	 */
	private isTriggerSatisfied(trigger: QuestTrigger, context: QuestContext): boolean {
		switch (trigger.type) {
			case 'session_count': {
				const sessionCount = context.sessionCount ?? 0;
				if (trigger.thinkerId && context.sessionsWithThinker) {
					return (context.sessionsWithThinker[trigger.thinkerId] ?? 0) >= trigger.minSessions;
				}
				return sessionCount >= trigger.minSessions;
			}

			case 'thinker_unlocked': {
				return (context.unlockedThinkers ?? []).includes(trigger.thinkerId);
			}

			case 'reasoning_score': {
				if (context.reasoningScore === undefined) return false;
				return context.reasoningScore >= trigger.minScore;
			}

			case 'manual':
				// Manual triggers are always available (handled by UI/system)
				return false; // Don't auto-trigger manual quests

			default:
				return false;
		}
	}

	/**
	 * Check if completion criteria is satisfied
	 */
	private isCompletionSatisfied(
		completion: QuestCompletion | QuestCompletion[],
		context: QuestContext
	): boolean {
		const completions = Array.isArray(completion) ? completion : [completion];

		// All completion criteria must be satisfied
		return completions.every((c) => this.checkSingleCompletion(c, context));
	}

	/**
	 * Check a single completion criterion
	 */
	private checkSingleCompletion(completion: QuestCompletion, context: QuestContext): boolean {
		switch (completion.type) {
			case 'framework_used': {
				// Count occurrences of the framework in frameworksUsed
				const count = context.frameworksUsed.filter((f) => f === completion.frameworkId).length;
				return count >= completion.minCount;
			}

			case 'journal_entries': {
				const journalCount = context.journalCount ?? 0;
				if (completion.differentFrameworks) {
					// Check if we have entries with different frameworks
					const uniqueFrameworks = new Set(context.journalFrameworks ?? []).size;
					return journalCount >= completion.minCount && uniqueFrameworks >= completion.minCount;
				}
				return journalCount >= completion.minCount;
			}

			case 'days_elapsed': {
				if (context.daysElapsed === undefined) return false;
				return context.daysElapsed >= completion.minDays;
			}

			case 'session_count': {
				if (completion.thinkerId && context.sessionsWithThinker) {
					return (
						(context.sessionsWithThinker[completion.thinkerId] ?? 0) >=
						completion.minSessions
					);
				}
				return (context.sessionCount ?? 0) >= completion.minSessions;
			}

			case 'reasoning_score': {
				if (context.reasoningScore === undefined) return false;
				return context.reasoningScore >= completion.minScore;
			}

			default:
				return false;
		}
	}
}

// Export singleton instance
export const questEngine = new QuestEngine();
