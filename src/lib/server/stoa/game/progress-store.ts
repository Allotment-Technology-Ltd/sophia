import { create, query, update } from '$lib/server/db';
import type { StoaProgressState } from '$lib/types/stoa';

function userKey(userId: string): string {
	return userId.startsWith('user:') ? userId.slice('user:'.length) : userId;
}

function emptyProgress(): StoaProgressState {
	return {
		xp: 0,
		level: 1,
		unlockedThinkers: ['marcus'],
		masteredFrameworks: [],
		activeQuestIds: [],
		completedQuestIds: []
	};
}

function rowToProgress(row: Record<string, unknown>): StoaProgressState {
	return {
		xp: typeof row.xp === 'number' ? row.xp : 0,
		level: typeof row.level === 'number' ? row.level : 1,
		unlockedThinkers: Array.isArray(row.unlocked_thinkers)
			? (row.unlocked_thinkers as string[])
			: ['marcus'],
		masteredFrameworks: Array.isArray(row.mastered_frameworks)
			? (row.mastered_frameworks as string[])
			: [],
		activeQuestIds: Array.isArray(row.active_quest_ids) ? (row.active_quest_ids as string[]) : [],
		completedQuestIds: Array.isArray(row.completed_quest_ids)
			? (row.completed_quest_ids as string[])
			: []
	};
}

export async function getProgress(userId: string): Promise<StoaProgressState> {
	const uid = userKey(userId);
	const rows = await query<Record<string, unknown>[]>(
		`SELECT * FROM stoa_student_progress WHERE user_id = type::thing('user', $uid) LIMIT 1;`,
		{ uid }
	);
	const row = rows[0];
	if (!row) return emptyProgress();
	return rowToProgress(row);
}

async function ensureProgressRow(userId: string): Promise<{ id: string; state: StoaProgressState }> {
	const uid = userKey(userId);
	const existing = await query<Record<string, unknown>[]>(
		`SELECT id, * FROM stoa_student_progress WHERE user_id = type::thing('user', $uid) LIMIT 1;`,
		{ uid }
	);
	const first = existing[0];
	if (first && first.id != null) {
		return { id: String(first.id), state: rowToProgress(first) };
	}
	const created = await create<Record<string, unknown>>('stoa_student_progress', {
		user_id: `user:${uid}`,
		xp: 0,
		level: 1,
		unlocked_thinkers: ['marcus'],
		mastered_frameworks: [],
		active_quest_ids: [],
		completed_quest_ids: []
	});
	const id = (created as { id?: string }).id;
	if (!id) throw new Error('Failed to create stoa_student_progress row');
	return { id, state: rowToProgress(created) };
}

export async function addXp(userId: string, amount: number): Promise<StoaProgressState> {
	const { id, state } = await ensureProgressRow(userId);
	const nextXp = state.xp + amount;
	const nextLevel = Math.max(1, Math.floor(nextXp / 500) + 1);
	const merged = await update<Record<string, unknown>>(id, {
		xp: nextXp,
		level: nextLevel,
		updated_at: new Date().toISOString()
	});
	return rowToProgress(merged);
}

export async function unlockThinker(userId: string, thinkerId: string): Promise<void> {
	const { id, state } = await ensureProgressRow(userId);
	if (state.unlockedThinkers.includes(thinkerId)) return;
	await update(id, {
		unlocked_thinkers: [...state.unlockedThinkers, thinkerId],
		updated_at: new Date().toISOString()
	});
}

export async function masterFramework(userId: string, frameworkId: string): Promise<void> {
	const { id, state } = await ensureProgressRow(userId);
	if (state.masteredFrameworks.includes(frameworkId)) return;
	await update(id, {
		mastered_frameworks: [...state.masteredFrameworks, frameworkId],
		updated_at: new Date().toISOString()
	});
}

export async function startQuest(userId: string, questId: string): Promise<void> {
	const { id, state } = await ensureProgressRow(userId);
	if (state.completedQuestIds.includes(questId)) return;
	if (state.activeQuestIds.includes(questId)) return;
	await update(id, {
		active_quest_ids: [...state.activeQuestIds, questId],
		updated_at: new Date().toISOString()
	});
}

export async function completeQuest(
	userId: string,
	questId: string,
	sessionIds: string[],
	rewards?: { xpAwarded: number; unlockAwarded?: string }
): Promise<void> {
	const uid = userKey(userId);
	const dup = await query<Record<string, unknown>[]>(
		`SELECT id FROM stoa_quest_completion WHERE user_id = type::thing('user', $uid) AND quest_id = $quest_id LIMIT 1;`,
		{ uid, quest_id: questId }
	);
	if (dup.length > 0) return;

	const { id, state } = await ensureProgressRow(userId);
	const row: Record<string, unknown> = {
		user_id: `user:${uid}`,
		quest_id: questId,
		xp_awarded: rewards?.xpAwarded ?? 0,
		session_evidence: sessionIds
	};
	if (rewards?.unlockAwarded) row.unlock_awarded = rewards.unlockAwarded;
	await create('stoa_quest_completion', row);

	const active = state.activeQuestIds.filter((q) => q !== questId);
	const completed = state.completedQuestIds.includes(questId)
		? state.completedQuestIds
		: [...state.completedQuestIds, questId];

	await update(id, {
		active_quest_ids: active,
		completed_quest_ids: completed,
		updated_at: new Date().toISOString()
	});
}
