import type { QuestDefinition } from '../types';

/**
 * Seneca quest arc - mortality and friendship
 */

export const senecaLettersQuest: QuestDefinition = {
	id: 'seneca-letters',
	title: "Seneca's Letters",
	description:
		'Write four journal entries, each employing a different framework. Show the breadth of your philosophical practice.',
	frameworks: [],
	trigger: {
		type: 'thinker_unlocked',
		thinkerId: 'epictetus'
	},
	completion: [
		{
			type: 'journal_entries',
			minCount: 4,
			requiresDistinctFrameworks: true
		}
	],
	reward: {
		xp: 250,
		unlockThinkerId: 'seneca'
	}
};

export const timeIsShortQuest: QuestDefinition = {
	id: 'time-is-short',
	title: 'Time Is Short',
	description: 'Remember mortality. Apply memento mori twice to fully grasp the preciousness of the present.',
	frameworks: ['memento_mori'],
	trigger: {
		type: 'thinker_unlocked',
		thinkerId: 'seneca'
	},
	completion: [
		{
			type: 'framework_used',
			frameworkId: 'memento_mori',
			minCount: 2
		}
	],
	reward: {
		xp: 175
	}
};

export const SENECA_QUESTS: QuestDefinition[] = [senecaLettersQuest, timeIsShortQuest];
