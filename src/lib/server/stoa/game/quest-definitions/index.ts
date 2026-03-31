import type { QuestDefinition } from '../types';
import { EPICTETUS_QUESTS } from './epictetus';
import { MARCUS_QUESTS } from './marcus';
import { META_QUESTS } from './meta';
import { SIDE_QUESTS } from './side-quests';
import { SENECA_QUESTS } from './seneca';

export const ALL_QUESTS: QuestDefinition[] = [
	...MARCUS_QUESTS,
	...EPICTETUS_QUESTS,
	...SENECA_QUESTS,
	...META_QUESTS,
	...SIDE_QUESTS
];
