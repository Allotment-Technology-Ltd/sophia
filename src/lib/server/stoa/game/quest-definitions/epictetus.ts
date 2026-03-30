import type { QuestDefinition } from '../types';

export const EPICTETUS_QUESTS: QuestDefinition[] = [
	{
		id: 'dichotomy-test',
		title: 'The Dichotomy Test',
		frameworks: ['dichotomy_of_control'],
		trigger: { type: 'session_count', minSessions: 3 },
		completion: {
			type: 'framework_used',
			frameworkId: 'dichotomy_of_control',
			minCount: 3,
			distinctSituations: false
		},
		rewardXp: 175,
		unlockThinkerId: 'epictetus'
	},
	{
		id: 'epictetus-door',
		title: "Epictetus's Door",
		trigger: { type: 'thinker_unlocked', thinkerId: 'epictetus' },
		completion: { type: 'session_with_voice', minSessions: 2, thinkerId: 'epictetus' },
		rewardXp: 150
	}
];
