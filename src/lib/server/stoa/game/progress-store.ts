import { query } from '$lib/server/db';
import type { StoaProgressState } from '$lib/types/stoa';
import { getLevelFromXp } from './level-system';
import type { StoaProgressRecord } from './types';

const DEFAULT_UNLOCKED_THINKER = 'marcus';

let tablesEnsured = false;

function userRecordId(userId: string): string {
	return `user:${userId}`;
}

function uniq(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)));
}

function toProgressState(row?: Partial<StoaProgressRecord>): StoaProgressState {
	const xp = Math.max(0, typeof row?.xp === 'number' ? row.xp : 0);
	const levelFromXp = getLevelFromXp(xp);
	const unlocked = uniq(
		Array.isArray(row?.unlockedThinkers)
			? row.unlockedThinkers
			: Array.isArray((row as Record<string, unknown>)?.unlocked_thinkers)
				? (((row as Record<string, unknown>).unlocked_thinkers as string[]) ?? [])
				: []
	);
	return {
		xp,
		level: levelFromXp.level,
		levelTitle: levelFromXp.title,
		xpToNextLevel: levelFromXp.xpToNext,
		levelProgress: levelFromXp.levelProgress,
		unlockedThinkers: unlocked.length > 0 ? unlocked : [DEFAULT_UNLOCKED_THINKER],
		masteredFrameworks: uniq(
			Array.isArray(row?.masteredFrameworks)
				? row.masteredFrameworks
				: (((row as Record<string, unknown>)?.mastered_frameworks as string[]) ?? [])
		),
		activeQuestIds: uniq(
			Array.isArray(row?.activeQuestIds)
				? row.activeQuestIds
				: (((row as Record<string, unknown>)?.active_quest_ids as string[]) ?? [])
		),
		completedQuestIds: uniq(
			Array.isArray(row?.completedQuestIds)
				? row.completedQuestIds
				: (((row as Record<string, unknown>)?.completed_quest_ids as string[]) ?? [])
		)
	};
}

async function ensureGameTables(): Promise<void> {
	if (tablesEnsured) return;
	await query(`
    DEFINE TABLE IF NOT EXISTS stoa_student_progress SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS user_id ON stoa_student_progress TYPE record<user>;
    DEFINE FIELD IF NOT EXISTS xp ON stoa_student_progress TYPE int DEFAULT 0;
    DEFINE FIELD IF NOT EXISTS level ON stoa_student_progress TYPE int DEFAULT 1;
    DEFINE FIELD IF NOT EXISTS unlocked_thinkers ON stoa_student_progress TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS mastered_frameworks ON stoa_student_progress TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS active_quest_ids ON stoa_student_progress TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS completed_quest_ids ON stoa_student_progress TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS created_at ON stoa_student_progress TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at ON stoa_student_progress TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS idx_stoa_progress_user ON stoa_student_progress COLUMNS user_id UNIQUE;

    DEFINE TABLE IF NOT EXISTS stoa_quest_completion SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS user_id ON stoa_quest_completion TYPE record<user>;
    DEFINE FIELD IF NOT EXISTS quest_id ON stoa_quest_completion TYPE string;
    DEFINE FIELD IF NOT EXISTS completed_at ON stoa_quest_completion TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS xp_awarded ON stoa_quest_completion TYPE int;
    DEFINE FIELD IF NOT EXISTS unlock_awarded ON stoa_quest_completion TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS session_evidence ON stoa_quest_completion TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS completion_count ON stoa_quest_completion TYPE int DEFAULT 1;
    DEFINE INDEX IF NOT EXISTS idx_stoa_quest_completion_identity ON stoa_quest_completion COLUMNS user_id, quest_id UNIQUE;

    DEFINE TABLE IF NOT EXISTS stoa_framework_exposure SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS user_id ON stoa_framework_exposure TYPE record<user>;
    DEFINE FIELD IF NOT EXISTS framework_id ON stoa_framework_exposure TYPE string;
    DEFINE FIELD IF NOT EXISTS exposure_count ON stoa_framework_exposure TYPE int DEFAULT 0;
    DEFINE FIELD IF NOT EXISTS correct_application_count ON stoa_framework_exposure TYPE int DEFAULT 0;
    DEFINE FIELD IF NOT EXISTS last_used ON stoa_framework_exposure TYPE datetime;
    DEFINE INDEX IF NOT EXISTS idx_framework_user ON stoa_framework_exposure COLUMNS user_id, framework_id UNIQUE;
  `);
	tablesEnsured = true;
}

async function selectProgressRow(userId: string): Promise<StoaProgressRecord | null> {
	const rows = await query<StoaProgressRecord[]>(
		`SELECT *
     FROM stoa_student_progress
     WHERE user_id = <record<user>>$userRecord
     LIMIT 1`,
		{ userRecord: userRecordId(userId) }
	);
	return rows[0] ?? null;
}

async function writeProgressRow(userId: string, state: StoaProgressState): Promise<void> {
	await query(
		`UPSERT stoa_student_progress
     SET user_id = <record<user>>$userRecord,
         xp = $xp,
         level = $level,
         unlocked_thinkers = $unlockedThinkers,
         mastered_frameworks = $masteredFrameworks,
         active_quest_ids = $activeQuestIds,
         completed_quest_ids = $completedQuestIds,
         created_at = IF created_at = NONE THEN time::now() ELSE created_at END,
         updated_at = time::now()
     WHERE user_id = <record<user>>$userRecord`,
		{
			userRecord: userRecordId(userId),
			xp: state.xp,
			level: state.level,
			unlockedThinkers: state.unlockedThinkers,
			masteredFrameworks: state.masteredFrameworks,
			activeQuestIds: state.activeQuestIds,
			completedQuestIds: state.completedQuestIds
		}
	);
}

export async function getProgress(userId: string): Promise<StoaProgressState> {
	await ensureGameTables();
	const row = await selectProgressRow(userId);
	const state = toProgressState(row ?? undefined);
	if (!row) {
		await writeProgressRow(userId, state);
	}
	return state;
}

export async function addXp(userId: string, amount: number): Promise<StoaProgressState> {
	const progress = await getProgress(userId);
	const nextXp = Math.max(0, progress.xp + Math.max(0, Math.floor(amount)));
	const levelFromXp = getLevelFromXp(nextXp);
	const nextState: StoaProgressState = {
		...progress,
		xp: nextXp,
		level: levelFromXp.level,
		levelTitle: levelFromXp.title,
		xpToNextLevel: levelFromXp.xpToNext,
		levelProgress: levelFromXp.levelProgress
	};
	await writeProgressRow(userId, nextState);
	return nextState;
}

export async function unlockThinker(userId: string, thinkerId: string): Promise<void> {
	const progress = await getProgress(userId);
	if (progress.unlockedThinkers.includes(thinkerId)) return;
	const nextState: StoaProgressState = {
		...progress,
		unlockedThinkers: uniq([...progress.unlockedThinkers, thinkerId])
	};
	await writeProgressRow(userId, nextState);
}

export async function masterFramework(userId: string, frameworkId: string): Promise<void> {
	const progress = await getProgress(userId);
	if (progress.masteredFrameworks.includes(frameworkId)) return;
	const nextState: StoaProgressState = {
		...progress,
		masteredFrameworks: uniq([...progress.masteredFrameworks, frameworkId])
	};
	await writeProgressRow(userId, nextState);
}

export async function startQuest(userId: string, questId: string): Promise<void> {
	const progress = await getProgress(userId);
	if (progress.completedQuestIds.includes(questId) || progress.activeQuestIds.includes(questId)) return;
	const nextState: StoaProgressState = {
		...progress,
		activeQuestIds: uniq([...progress.activeQuestIds, questId])
	};
	await writeProgressRow(userId, nextState);
}

export async function completeQuest(userId: string, questId: string, sessionIds: string[]): Promise<void> {
	const progress = await getProgress(userId);
	if (progress.completedQuestIds.includes(questId)) return;

	const nextState: StoaProgressState = {
		...progress,
		activeQuestIds: progress.activeQuestIds.filter((id) => id !== questId),
		completedQuestIds: uniq([...progress.completedQuestIds, questId])
	};
	await writeProgressRow(userId, nextState);

	await query(
		`UPSERT stoa_quest_completion
     SET user_id = <record<user>>$userRecord,
         quest_id = $questId,
         completed_at = IF completed_at = NONE THEN time::now() ELSE completed_at END,
         xp_awarded = IF xp_awarded = NONE THEN 0 ELSE xp_awarded END,
         unlock_awarded = IF unlock_awarded = NONE THEN NONE ELSE unlock_awarded END,
         session_evidence = $sessionEvidence,
         completion_count = IF completion_count = NONE THEN 1 ELSE completion_count
     WHERE user_id = <record<user>>$userRecord AND quest_id = $questId`,
		{
			userRecord: userRecordId(userId),
			questId,
			sessionEvidence: uniq(sessionIds)
		}
	);
}

export async function deactivateQuest(userId: string, questId: string): Promise<void> {
	const progress = await getProgress(userId);
	if (!progress.activeQuestIds.includes(questId)) return;
	const nextState: StoaProgressState = {
		...progress,
		activeQuestIds: progress.activeQuestIds.filter((id) => id !== questId)
	};
	await writeProgressRow(userId, nextState);
}

export interface QuestCompletionSummary {
	questId: string;
	completedAt: string | null;
	xpAwarded: number;
}

export async function listQuestCompletions(userId: string): Promise<QuestCompletionSummary[]> {
	await ensureGameTables();
	const rows = await query<Array<{ quest_id?: string; completed_at?: string; xp_awarded?: number }>>(
		`SELECT quest_id, completed_at, xp_awarded
     FROM stoa_quest_completion
     WHERE user_id = <record<user>>$userRecord`,
		{ userRecord: userRecordId(userId) }
	);
	return rows
		.filter((row) => typeof row.quest_id === 'string' && row.quest_id.length > 0)
		.map((row) => ({
			questId: row.quest_id as string,
			completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
			xpAwarded: Math.max(0, Number(row.xp_awarded ?? 0))
		}));
}
