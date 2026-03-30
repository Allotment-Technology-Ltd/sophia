import { ALL_QUESTS } from './quest-definitions';
import type { QuestContext, QuestDefinition } from './types';
import { addXp, completeQuest, getProgress, startQuest, unlockThinker } from './progress-store';

function triggerSatisfied(
	q: QuestDefinition,
	ctx: QuestContext,
	progress: Awaited<ReturnType<typeof getProgress>>
): boolean {
	switch (q.trigger.type) {
		case 'session_count':
			return (ctx.sessionCount ?? 0) >= q.trigger.minSessions;
		case 'manual':
			return false;
		case 'thinker_unlocked':
			return progress.unlockedThinkers.includes(q.trigger.thinkerId);
		case 'reasoning_score':
			return (ctx.reasoningScore ?? 0) >= q.trigger.minScore;
		default:
			return false;
	}
}

function countFrameworkUses(
	frameworkId: string,
	ctx: QuestContext,
	distinctSituations: boolean | undefined
): number {
	const uses = ctx.frameworksUsed?.filter((u) => u.frameworkId === frameworkId) ?? [];
	if (!distinctSituations) return uses.length;
	const situations = new Set(
		uses.map((u) => u.situationId ?? `${u.frameworkId}:default`)
	);
	return situations.size;
}

function completionSatisfied(q: QuestDefinition, ctx: QuestContext): boolean {
	const c = q.completion;
	switch (c.type) {
		case 'framework_used':
			return countFrameworkUses(c.frameworkId, ctx, c.distinctSituations) >= c.minCount;
		case 'journal_entries': {
			const n = c.frameworkId
				? (ctx.journalEntriesByFramework?.[c.frameworkId] ?? 0)
				: (ctx.journalCount ?? 0);
			return n >= c.minCount;
		}
		case 'days_and_journal':
			return (
				(ctx.daysElapsed ?? 0) >= c.daysElapsed && (ctx.journalCount ?? 0) >= c.journalMinCount
			);
		case 'session_with_voice':
			return (ctx.voiceSessionCounts?.[c.thinkerId] ?? 0) >= c.minSessions;
		case 'journal_distinct_frameworks': {
			const keys = Object.keys(ctx.journalEntriesByFramework ?? {});
			return keys.length >= c.minCount;
		}
		case 'reasoning_improved': {
			const cur = ctx.reasoningScore ?? 0;
			if (cur < c.minScore) return false;
			if (ctx.priorReasoningScore !== undefined && cur <= ctx.priorReasoningScore) return false;
			return true;
		}
		default:
			return false;
	}
}

export class QuestEngine {
	async evaluateTriggers(userId: string, ctx: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		const out: QuestDefinition[] = [];
		for (const q of ALL_QUESTS) {
			if (progress.completedQuestIds.includes(q.id)) continue;
			if (progress.activeQuestIds.includes(q.id)) continue;
			if (triggerSatisfied(q, ctx, progress)) out.push(q);
		}
		return out;
	}

	async evaluateCompletions(userId: string, ctx: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		const out: QuestDefinition[] = [];
		for (const qid of progress.activeQuestIds) {
			const q = ALL_QUESTS.find((x) => x.id === qid);
			if (!q) continue;
			if (progress.completedQuestIds.includes(q.id)) continue;
			if (completionSatisfied(q, ctx)) out.push(q);
		}
		return out;
	}

	async awardCompletion(userId: string, quest: QuestDefinition, sessionIds?: string[]): Promise<void> {
		const progress = await getProgress(userId);
		if (progress.completedQuestIds.includes(quest.id)) return;

		const evidence = sessionIds ?? [];
		await completeQuest(userId, quest.id, evidence, {
			xpAwarded: quest.rewardXp,
			unlockAwarded: quest.unlockThinkerId
		});
		await addXp(userId, quest.rewardXp);
		if (quest.unlockThinkerId) {
			await unlockThinker(userId, quest.unlockThinkerId);
		}
	}
}

export const questEngine = new QuestEngine();

export { startQuest };
