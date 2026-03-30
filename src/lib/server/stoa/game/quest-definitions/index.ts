import { EPICTETUS_QUESTS } from './epictetus';
import { MARCUS_QUESTS } from './marcus';
import { META_QUESTS } from './meta';
import { SENECA_QUESTS } from './seneca';
import type { QuestDefinition } from '../types';

export const ALL_QUESTS: QuestDefinition[] = [
	...MARCUS_QUESTS,
	...EPICTETUS_QUESTS,
	...SENECA_QUESTS,
	...META_QUESTS
];

export { MARCUS_QUESTS, EPICTETUS_QUESTS, SENECA_QUESTS, META_QUESTS };
export type { QuestDefinition };
