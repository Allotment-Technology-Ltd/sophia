import type { QuestDefinition } from '../types';

/**
 * Marcus Aurelius quest arc - intro to Stoic practice
 */

export const viewFromAboveQuest: QuestDefinition = {
	id: 'view-from-above',
	title: 'The View from Above',
	description:
		'Practice seeing your situation from a cosmic perspective. What remains significant when viewed from above?',
	frameworks: ['negative_visualisation', 'cosmic_perspective'],
	trigger: {
		type: 'session_count',
		minSessions: 2
	},
	completion: [
		{
			type: 'framework_used',
			frameworkId: 'cosmic_perspective',
			minCount: 1
		}
	],
	reward: {
		xp: 150
	},
	dialogueSeed:
		'There is a practice Marcus returned to often. Look at your situation from above — from a great height. What remains significant?'
};

export const morningIntentionQuest: QuestDefinition = {
	id: 'morning-intention',
	title: 'The Morning Intention',
	description: 'Begin each day with deliberate intention. Prepare for what lies ahead.',
	frameworks: ['morning_preparation'],
	trigger: {
		type: 'manual'
	},
	completion: [
		{
			type: 'journal_entries',
			minCount: 3
		}
	],
	reward: {
		xp: 100,
		unlockZoneId: 'garden'
	}
};

export const examinedWeekQuest: QuestDefinition = {
	id: 'examined-week',
	title: 'The Examined Week',
	description: 'Seven days of evening reflection. What patterns emerge when you look back?',
	frameworks: ['evening_reflection'],
	trigger: {
		type: 'thinker_unlocked',
		thinkerId: 'marcus'
	},
	completion: [
		{
			type: 'days_elapsed',
			minDays: 7
		},
		{
			type: 'journal_entries',
			minCount: 5,
			requiresDistinctFrameworks: false
		}
	],
	reward: {
		xp: 200
	}
};

export const MARCUS_QUESTS: QuestDefinition[] = [
	viewFromAboveQuest,
	morningIntentionQuest,
	examinedWeekQuest
];
