import type { QuestDefinition } from '../types';

export const SENECA_QUESTS: QuestDefinition[] = [
	{
		id: 'seneca-letters',
		title: "Seneca's Letters",
		trigger: { type: 'thinker_unlocked', thinkerId: 'epictetus' },
		completion: { type: 'journal_distinct_frameworks', minCount: 4 },
		rewardXp: 250,
		unlockThinkerId: 'seneca'
	},
	{
		id: 'time-is-short',
		title: 'Time Is Short',
		frameworks: ['memento_mori'],
		trigger: { type: 'thinker_unlocked', thinkerId: 'seneca' },
		completion: { type: 'framework_used', frameworkId: 'memento_mori', minCount: 2 },
		rewardXp: 175
	}
];
