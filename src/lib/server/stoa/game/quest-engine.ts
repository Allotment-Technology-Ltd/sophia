import { query } from '$lib/server/db';
import { ALL_QUESTS } from './quest-definitions';
import { addXp, completeQuest, deactivateQuest, getProgress, startQuest, unlockThinker } from './progress-store';
import type { QuestCompletionRow, QuestContext, QuestDefinition, QuestTrigger, QuestCompletionRule } from './types';
import { getReasoningTrend } from './reasoning-progression';

function userRecordId(userId: string): string {
	return `user:${userId}`;
}

export class QuestEngine {
	async evaluateTriggers(userId: string, context: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		const available: QuestDefinition[] = [];
		const sessionCount = await this.getSessionCount(userId);

		for (const quest of ALL_QUESTS) {
			if (progress.activeQuestIds.includes(quest.id)) continue;
			if (!quest.repeatable && progress.completedQuestIds.includes(quest.id)) continue;
			if (quest.repeatable && (await this.isQuestOnCooldown(userId, quest))) continue;
			if (await this.matchesTrigger(userId, quest.trigger, context, sessionCount)) {
				available.push(quest);
				await startQuest(userId, quest.id);
			}
		}

		await this.recordReasoningAssessment(userId, context);
		await this.recordFrameworkExposure(userId, context);
		return available;
	}

	async evaluateCompletions(userId: string, context: QuestContext): Promise<QuestDefinition[]> {
		const progress = await getProgress(userId);
		if (progress.activeQuestIds.length === 0) {
			await this.recordReasoningAssessment(userId, context);
			await this.recordFrameworkExposure(userId, context);
			return [];
		}

		const completed: QuestDefinition[] = [];
		const sessionCount = await this.getSessionCount(userId);
		const activeSet = new Set(progress.activeQuestIds);
		const quests = ALL_QUESTS.filter((quest) => activeSet.has(quest.id));

		for (const quest of quests) {
			if (!quest.repeatable && progress.completedQuestIds.includes(quest.id)) continue;
			if (!quest.repeatable) {
				const alreadyLogged = await this.hasCompletionLog(userId, quest.id);
				if (alreadyLogged) continue;
			} else if (await this.isQuestOnCooldown(userId, quest)) {
				continue;
			}
			const isComplete = await this.matchesAllCompletionRules(userId, quest.completion, context, sessionCount);
			if (isComplete) completed.push(quest);
		}

		await this.recordReasoningAssessment(userId, context);
		await this.recordFrameworkExposure(userId, context);
		return completed;
	}

	async awardCompletion(userId: string, quest: QuestDefinition): Promise<void> {
		const progress = await getProgress(userId);
		if (!quest.repeatable) {
			if (progress.completedQuestIds.includes(quest.id)) return;
			if (await this.hasCompletionLog(userId, quest.id)) return;
		} else if (await this.isQuestOnCooldown(userId, quest)) {
			return;
		}

		if (quest.repeatable) {
			await deactivateQuest(userId, quest.id);
		} else {
			await completeQuest(userId, quest.id, []);
		}
		await addXp(userId, quest.reward.xp);
		if (quest.reward.unlockThinkerId) {
			await unlockThinker(userId, quest.reward.unlockThinkerId);
		}

		await query(
			`UPSERT stoa_quest_completion
       SET user_id = <record<user>>$userRecord,
           quest_id = $questId,
           completed_at = time::now(),
           xp_awarded = IF xp_awarded = NONE THEN $xpAwarded ELSE xp_awarded + $xpAwarded END,
           unlock_awarded = $unlockAwarded,
           session_evidence = IF session_evidence = NONE THEN [] ELSE session_evidence END,
           completion_count = IF completion_count = NONE THEN 1 ELSE completion_count + 1 END
       WHERE user_id = <record<user>>$userRecord AND quest_id = $questId`,
			{
				userRecord: userRecordId(userId),
				questId: quest.id,
				xpAwarded: quest.reward.xp,
				unlockAwarded: quest.reward.unlockThinkerId ?? null
			}
		);
	}

	private async matchesTrigger(
		userId: string,
		trigger: QuestTrigger,
		context: QuestContext,
		sessionCount: number
	): Promise<boolean> {
		switch (trigger.type) {
			case 'manual':
				return sessionCount >= 1;
			case 'session_count':
				return sessionCount >= trigger.minSessions;
			case 'thinker_unlocked': {
				const progress = await getProgress(userId);
				return progress.unlockedThinkers.includes(trigger.thinkerId);
			}
			case 'reasoning_score':
				if (!trigger.requiresImprovement) {
					return context.reasoningScore >= trigger.minScore;
				}
				if (context.reasoningScore < trigger.minScore) {
					return false;
				}
				const trend = await getReasoningTrend(userId, 10);
				return trend.isImproving;
			default:
				return false;
		}
	}

	private async matchesAllCompletionRules(
		userId: string,
		rules: QuestCompletionRule[],
		context: QuestContext,
		sessionCount: number
	): Promise<boolean> {
		for (const rule of rules) {
			if (!(await this.matchesCompletionRule(userId, rule, context, sessionCount))) {
				return false;
			}
		}
		return true;
	}

	private async matchesCompletionRule(
		userId: string,
		rule: QuestCompletionRule,
		context: QuestContext,
		sessionCount: number
	): Promise<boolean> {
		switch (rule.type) {
			case 'framework_used': {
				const rows = await query<Array<{ exposure_count?: number; correct_application_count?: number }>>(
					`SELECT exposure_count, correct_application_count
           FROM stoa_framework_exposure
           WHERE user_id = <record<user>>$userRecord
             AND framework_id = $frameworkId
           LIMIT 1`,
					{
						userRecord: userRecordId(userId),
						frameworkId: rule.frameworkId
					}
				);
				const row = rows[0];
				const count = Math.max(
					Number(row?.correct_application_count ?? 0),
					context.frameworksUsed.filter((value) => value === rule.frameworkId).length
				);
				if (rule.distinctRealSituations) {
					return count >= rule.minCount && context.frameworksUsed.includes(rule.frameworkId);
				}
				return count >= rule.minCount;
			}
			case 'journal_entries': {
				if (!rule.requiresDistinctFrameworks) {
					return context.journalCount >= rule.minCount;
				}
				const rows = await query<Array<{ themes?: string[] }>>(
					`SELECT themes
           FROM stoa_journal_entry
           WHERE user_id = $userId
           ORDER BY created_at DESC
           LIMIT 100`,
					{ userId }
				);
				const frameworks = new Set<string>();
				for (const row of rows) {
					for (const theme of row.themes ?? []) {
						if (theme.startsWith('framework:')) {
							frameworks.add(theme.replace('framework:', ''));
						}
					}
				}
				return context.journalCount >= rule.minCount && frameworks.size >= rule.minCount;
			}
			case 'days_elapsed':
				return context.daysElapsed >= rule.minDays;
			case 'session_count':
				if (rule.thinkerId) {
					const markerA = `voice:${rule.thinkerId}`;
					const markerB = `thinker:${rule.thinkerId}`;
					return sessionCount >= rule.minSessions && context.frameworksUsed.some((f) => f === markerA || f === markerB);
				}
				return sessionCount >= rule.minSessions;
			case 'reasoning_score':
				if (!rule.requiresImprovement) {
					return context.reasoningScore >= rule.minScore;
				}
				const baseline = await this.getReasoningBaseline(userId, context.sessionId);
				return context.reasoningScore >= rule.minScore && context.reasoningScore > baseline;
			case 'distinct_session_days':
				if (rule.requireConsecutive) {
					return this.hasConsecutiveSessionDays(userId, rule.minDays);
				}
				return (await this.getDistinctSessionDayCount(userId)) >= rule.minDays;
			case 'manual_signal':
				return (context.manualSignals ?? []).includes(rule.signalId);
			case 'challenge_engagement': {
				const minTurnIndex = Math.max(1, rule.minTurnIndex ?? 2);
				return context.stance === 'challenge' && context.turnIndex >= minTurnIndex;
			}
			case 'stance_streak':
				return this.hasStanceStreak(userId, context.sessionId, rule.stance, rule.minConsecutiveTurns);
			case 'session_start_window': {
				const hour = context.sessionStartHourLocal;
				if (typeof hour !== 'number') return false;
				return hour >= rule.startHourInclusive && hour < rule.endHourExclusive;
			}
			default:
				return false;
		}
	}

	private async getLastCompletionAt(userId: string, questId: string): Promise<Date | null> {
		const rows = await query<Array<{ completed_at?: string }>>(
			`SELECT completed_at
       FROM stoa_quest_completion
       WHERE user_id = <record<user>>$userRecord
         AND quest_id = $questId
       LIMIT 1`,
			{
				userRecord: userRecordId(userId),
				questId
			}
		);
		const iso = rows[0]?.completed_at;
		if (typeof iso !== 'string' || iso.length === 0) return null;
		const value = new Date(iso);
		return Number.isNaN(value.getTime()) ? null : value;
	}

	private async isQuestOnCooldown(userId: string, quest: QuestDefinition): Promise<boolean> {
		if (!quest.repeatable) return false;
		const completedAt = await this.getLastCompletionAt(userId, quest.id);
		if (!completedAt) return false;
		const now = Date.now();
		const elapsed = now - completedAt.getTime();
		const cooldownMs = quest.repeatable.cooldown === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
		return elapsed < cooldownMs;
	}

	private async hasCompletionLog(userId: string, questId: string): Promise<boolean> {
		const rows = await query<QuestCompletionRow[]>(
			`SELECT id
       FROM stoa_quest_completion
       WHERE user_id = <record<user>>$userRecord
         AND quest_id = $questId
       LIMIT 1`,
			{
				userRecord: userRecordId(userId),
				questId
			}
		);
		return rows.length > 0;
	}

	private async getSessionCount(userId: string): Promise<number> {
		const rows = await query<Array<{ total?: number }>>(
			`SELECT count() AS total
       FROM stoa_session
       WHERE user_id = $userId
       GROUP ALL`,
			{ userId }
		);
		return typeof rows[0]?.total === 'number' ? rows[0].total : 0;
	}

	private async getDistinctSessionDayCount(userId: string): Promise<number> {
		const rows = await query<Array<{ timestamp?: string }>>(
			`SELECT timestamp
       FROM stoa_session_turn
       WHERE user_id = $userId
       ORDER BY timestamp DESC
       LIMIT 400`,
			{ userId }
		);
		const uniqueDays = new Set<string>();
		for (const row of rows) {
			if (typeof row.timestamp !== 'string') continue;
			const day = row.timestamp.slice(0, 10);
			if (day.length === 10) uniqueDays.add(day);
		}
		return uniqueDays.size;
	}

	private async hasConsecutiveSessionDays(userId: string, minDays: number): Promise<boolean> {
		const rows = await query<Array<{ timestamp?: string }>>(
			`SELECT timestamp
       FROM stoa_session_turn
       WHERE user_id = $userId
       ORDER BY timestamp DESC
       LIMIT 500`,
			{ userId }
		);
		const uniqueDays = Array.from(
			new Set(
				rows
					.map((row) => (typeof row.timestamp === 'string' ? row.timestamp.slice(0, 10) : ''))
					.filter((value) => value.length === 10)
			)
		);
		if (uniqueDays.length < minDays) return false;

		const sortedDays = uniqueDays
			.map((day) => new Date(`${day}T00:00:00.000Z`))
			.filter((value) => !Number.isNaN(value.getTime()))
			.sort((a, b) => b.getTime() - a.getTime());

		let streak = 1;
		for (let i = 1; i < sortedDays.length; i += 1) {
			const deltaDays = Math.round((sortedDays[i - 1].getTime() - sortedDays[i].getTime()) / (1000 * 60 * 60 * 24));
			if (deltaDays === 1) {
				streak += 1;
				if (streak >= minDays) return true;
			} else if (deltaDays > 1) {
				streak = 1;
			}
		}

		return streak >= minDays;
	}

	private async hasStanceStreak(
		userId: string,
		sessionId: string,
		stance: 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with',
		minConsecutiveTurns: number
	): Promise<boolean> {
		const rows = await query<Array<{ stance?: string }>>(
			`SELECT stance
       FROM stoa_session_turn
       WHERE user_id = $userId
         AND session_id = $sessionId
       ORDER BY timestamp DESC
       LIMIT 20`,
			{ userId, sessionId }
		);

		let streak = 0;
		for (const row of rows) {
			if (row.stance === stance) {
				streak += 1;
				if (streak >= minConsecutiveTurns) return true;
			} else if (typeof row.stance === 'string' && row.stance.length > 0) {
				break;
			}
		}
		return false;
	}

	private async getReasoningBaseline(userId: string, sessionId: string): Promise<number> {
		const rows = await query<Array<{ quality_score?: number }>>(
			`SELECT quality_score
       FROM stoa_reasoning_assessment
       WHERE user_id = <record<user>>$userRecord
         AND session_id != $sessionId
       ORDER BY assessed_at DESC
       LIMIT 20`,
			{
				userRecord: userRecordId(userId),
				sessionId
			}
		);
		if (rows.length === 0) return 0;
		const scores = rows.map((row) => Number(row.quality_score ?? 0)).filter((score) => Number.isFinite(score));
		if (scores.length === 0) return 0;
		return scores.reduce((acc, value) => acc + value, 0) / scores.length;
	}

	private async recordReasoningAssessment(userId: string, context: QuestContext): Promise<void> {
		await query(
			`UPSERT stoa_reasoning_assessment
       SET session_id = $sessionId,
           user_id = <record<user>>$userRecord,
           turn_index = $turnIndex,
           quality_score = $qualityScore,
           dimensions = IF dimensions = NONE THEN {} ELSE dimensions,
           frameworks_applied = $frameworksApplied,
           assessed_at = time::now()
       WHERE user_id = <record<user>>$userRecord
         AND session_id = $sessionId
         AND turn_index = $turnIndex`,
			{
				sessionId: context.sessionId,
				userRecord: userRecordId(userId),
				turnIndex: context.turnIndex,
				qualityScore: context.reasoningScore,
				frameworksApplied: context.frameworksUsed
			}
		);
	}

	private async recordFrameworkExposure(userId: string, context: QuestContext): Promise<void> {
		const byFramework = new Map<string, number>();
		for (const framework of context.frameworksUsed) {
			byFramework.set(framework, (byFramework.get(framework) ?? 0) + 1);
		}
		if (byFramework.size === 0) return;

		for (const [frameworkId, count] of byFramework.entries()) {
			await query(
				`UPSERT stoa_framework_exposure
         SET user_id = <record<user>>$userRecord,
             framework_id = $frameworkId,
             exposure_count = IF exposure_count = NONE THEN $count ELSE exposure_count + $count END,
             correct_application_count = IF correct_application_count = NONE THEN $correctCount ELSE correct_application_count + $correctCount END,
             last_used = time::now()
         WHERE user_id = <record<user>>$userRecord AND framework_id = $frameworkId`,
				{
					userRecord: userRecordId(userId),
					frameworkId,
					count,
					correctCount: context.reasoningScore >= 0.65 ? count : 0
				}
			);
		}
	}
}
