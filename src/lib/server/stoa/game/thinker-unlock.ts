import type { ThinkerProfile } from '$lib/types/stoa';
import { getProgress } from './progress-store';

export const THINKER_REGISTRY: ThinkerProfile[] = [
	{
		id: 'marcus',
		name: 'Marcus Aurelius',
		dates: '121–180 CE',
		zone: 'colonnade',
		isUnlocked: true,
		spritePath: '/static/stoa/marcus.png',
		voiceSignature: 'marcus_med'
	},
	{
		id: 'epictetus',
		name: 'Epictetus',
		dates: 'c. 50–135 CE',
		zone: 'shrines',
		isUnlocked: false,
		spritePath: '/static/stoa/epictetus.png',
		voiceSignature: 'epictetus_firm'
	},
	{
		id: 'seneca',
		name: 'Seneca',
		dates: 'c. 4 BCE–65 CE',
		zone: 'library',
		isUnlocked: false,
		spritePath: '/static/stoa/seneca.png',
		voiceSignature: 'seneca_letter'
	},
	{
		id: 'zeno',
		name: 'Zeno of Citium',
		dates: 'c. 334–262 BCE',
		zone: 'garden',
		isUnlocked: false,
		spritePath: '/static/stoa/zeno.png',
		voiceSignature: 'zeno_origin'
	},
	{
		id: 'cleanthes',
		name: 'Cleanthes',
		dates: 'c. 330–230 BCE',
		zone: 'garden',
		isUnlocked: false,
		spritePath: '/static/stoa/cleanthes.png',
		voiceSignature: 'cleanthes_hymn'
	}
];

export async function isUnlocked(userId: string, thinkerId: string): Promise<boolean> {
	const p = await getProgress(userId);
	return p.unlockedThinkers.includes(thinkerId);
}

export async function getUnlockedThinkers(userId: string): Promise<ThinkerProfile[]> {
	const p = await getProgress(userId);
	return THINKER_REGISTRY.map((t) => ({
		...t,
		isUnlocked: p.unlockedThinkers.includes(t.id)
	})).filter((t) => t.isUnlocked);
}
