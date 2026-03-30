/**
 * Student progress persistence layer
 * Server-side SurrealDB read/write for stoa game state
 */

import { query, create } from '../../db.js';
import type { StoaProgressState } from '../../../types/stoa.js';
import type {
	StudentProgressRecord,
	QuestCompletionRecord
} from './quest-definitions/types.js';

const DEFAULT_PROGRESS: StoaProgressState = {
	xp: 0,
	level: 1,
	unlockedThinkers: ['marcus'],
	masteredFrameworks: [],
	activeQuestIds: [],
	completedQuestIds: []
};

/**
 * Get or create student progress for a user
 */
export async function getProgress(userId: string): Promise<StoaProgressState> {
	try {
		const results = await query<StudentProgressRecord[]>(
			`SELECT * FROM stoa_student_progress WHERE user_id = type::thing($userId)`,
			{ userId: `user:${userId}` }
		);

		if (!results || results.length === 0) {
			// Create default progress for new user
			await create<StudentProgressRecord>('stoa_student_progress', {
				user_id: `user:${userId}`,
				xp: DEFAULT_PROGRESS.xp,
				level: DEFAULT_PROGRESS.level,
				unlocked_thinkers: DEFAULT_PROGRESS.unlockedThinkers,
				mastered_frameworks: DEFAULT_PROGRESS.masteredFrameworks,
				active_quest_ids: DEFAULT_PROGRESS.activeQuestIds,
				completed_quest_ids: DEFAULT_PROGRESS.completedQuestIds,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			});
			return { ...DEFAULT_PROGRESS };
		}

		const record = results[0];
		return {
			xp: record.xp ?? DEFAULT_PROGRESS.xp,
			level: record.level ?? DEFAULT_PROGRESS.level,
			unlockedThinkers: record.unlocked_thinkers ?? DEFAULT_PROGRESS.unlockedThinkers,
			masteredFrameworks: record.mastered_frameworks ?? DEFAULT_PROGRESS.masteredFrameworks,
			activeQuestIds: record.active_quest_ids ?? DEFAULT_PROGRESS.activeQuestIds,
			completedQuestIds: record.completed_quest_ids ?? DEFAULT_PROGRESS.completedQuestIds
		};
	} catch (error) {
		console.error('[ProgressStore] getProgress error:', error);
		return { ...DEFAULT_PROGRESS };
	}
}

/**
 * Add XP to a user's progress
 */
export async function addXp(userId: string, amount: number): Promise<StoaProgressState> {
	try {
		const current = await getProgress(userId);
		const newXp = current.xp + amount;

		// Simple level calculation: every 500 XP = level up
		const newLevel = Math.floor(newXp / 500) + 1;

		await query(
			`UPDATE stoa_student_progress 
			 SET xp = $newXp, 
			     level = $newLevel,
			     updated_at = time::now()
			 WHERE user_id = type::thing($userId)`,
			{
				userId: `user:${userId}`,
				newXp,
				newLevel
			}
		);

		return {
			...current,
			xp: newXp,
			level: newLevel
		};
	} catch (error) {
		console.error('[ProgressStore] addXp error:', error);
		throw error;
	}
}

/**
 * Unlock a thinker for a user
 */
export async function unlockThinker(userId: string, thinkerId: string): Promise<void> {
	try {
		await query(
			`UPDATE stoa_student_progress 
			 SET unlocked_thinkers = array::distinct(array::append(unlocked_thinkers, $thinkerId)),
			     updated_at = time::now()
			 WHERE user_id = type::thing($userId)`,
			{
				userId: `user:${userId}`,
				thinkerId
			}
		);
	} catch (error) {
		console.error('[ProgressStore] unlockThinker error:', error);
		throw error;
	}
}

/**
 * Mark a framework as mastered for a user
 */
export async function masterFramework(userId: string, frameworkId: string): Promise<void> {
	try {
		await query(
			`UPDATE stoa_student_progress 
			 SET mastered_frameworks = array::distinct(array::append(mastered_frameworks, $frameworkId)),
			     updated_at = time::now()
			 WHERE user_id = type::thing($userId)`,
			{
				userId: `user:${userId}`,
				frameworkId
			}
		);
	} catch (error) {
		console.error('[ProgressStore] masterFramework error:', error);
		throw error;
	}
}

/**
 * Start a quest (add to active quests)
 */
export async function startQuest(userId: string, questId: string): Promise<void> {
	try {
		await query(
			`UPDATE stoa_student_progress 
			 SET active_quest_ids = array::distinct(array::append(active_quest_ids, $questId)),
			     updated_at = time::now()
			 WHERE user_id = type::thing($userId)`,
			{
				userId: `user:${userId}`,
				questId
			}
		);
	} catch (error) {
		console.error('[ProgressStore] startQuest error:', error);
		throw error;
	}
}

/**
 * Complete a quest (move from active to completed, record completion)
 */
export async function completeQuest(
	userId: string,
	questId: string,
	sessionIds: string[],
	xpAwarded: number,
	unlockAwarded?: string
): Promise<void> {
	try {
		// Remove from active and add to completed
		await query(
			`UPDATE stoa_student_progress 
			 SET active_quest_ids = array::remove(active_quest_ids, $questId),
			     completed_quest_ids = array::distinct(array::append(completed_quest_ids, $questId)),
			     updated_at = time::now()
			 WHERE user_id = type::thing($userId)`,
			{
				userId: `user:${userId}`,
				questId
			}
		);

		// Create completion record
		await create<QuestCompletionRecord>('stoa_quest_completion', {
			user_id: `user:${userId}`,
			quest_id: questId,
			completed_at: new Date().toISOString(),
			xp_awarded: xpAwarded,
			unlock_awarded: unlockAwarded ?? null,
			session_evidence: sessionIds
		});
	} catch (error) {
		console.error('[ProgressStore] completeQuest error:', error);
		throw error;
	}
}

/**
 * Check if a quest is already completed (idempotency check)
 */
export async function isQuestCompleted(userId: string, questId: string): Promise<boolean> {
	try {
		const results = await query<{ completed_quest_ids: string[] }[]>(
			`SELECT completed_quest_ids FROM stoa_student_progress WHERE user_id = type::thing($userId)`,
			{ userId: `user:${userId}` }
		);

		if (!results || results.length === 0) {
			return false;
		}

		const completedIds = results[0]?.completed_quest_ids ?? [];
		return completedIds.includes(questId);
	} catch (error) {
		console.error('[ProgressStore] isQuestCompleted error:', error);
		return false;
	}
}

/**
 * Check if a quest is already active
 */
export async function isQuestActive(userId: string, questId: string): Promise<boolean> {
	try {
		const results = await query<{ active_quest_ids: string[] }[]>(
			`SELECT active_quest_ids FROM stoa_student_progress WHERE user_id = type::thing($userId)`,
			{ userId: `user:${userId}` }
		);

		if (!results || results.length === 0) {
			return false;
		}

		const activeIds = results[0]?.active_quest_ids ?? [];
		return activeIds.includes(questId);
	} catch (error) {
		console.error('[ProgressStore] isQuestActive error:', error);
		return false;
	}
}
