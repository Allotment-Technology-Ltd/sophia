import type { QuestDefinition } from '../types';

export const MARCUS_QUESTS: QuestDefinition[] = [
	{
		id: 'view-from-above',
		title: 'The View from Above',
		frameworks: ['negative_visualisation', 'cosmic_perspective'],
		trigger: { type: 'session_count', minSessions: 2 },
		completion: {
			type: 'framework_used',
			frameworkId: 'cosmic_perspective',
			minCount: 1,
			distinctSituations: true
		},
		rewardXp: 150,
		dialogueSeed:
			'There is a practice Marcus returned to often. Look at your situation from above — from a great height. What remains significant?'
	},
	{
		id: 'morning-intention',
		title: 'The Morning Intention',
		frameworks: ['morning_preparation'],
		trigger: { type: 'manual' },
		completion: { type: 'journal_entries', minCount: 3, frameworkId: 'morning_preparation' },
		rewardXp: 100,
		unlockZone: 'garden'
	},
	{
		id: 'examined-week',
		title: 'The Examined Week',
		frameworks: ['evening_reflection'],
		trigger: { type: 'thinker_unlocked', thinkerId: 'marcus' },
		completion: { type: 'days_and_journal', daysElapsed: 7, journalMinCount: 5 },
		rewardXp: 200
	}
];
