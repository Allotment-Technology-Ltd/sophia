import type { ThinkerProfile, StoaZone } from '$lib/types/stoa';

export const STOA_THINKER_REGISTRY: ThinkerProfile[] = [
	{
		id: 'marcus',
		name: 'Marcus Aurelius',
		dates: '121–180 CE',
		zone: 'colonnade' as StoaZone,
		isUnlocked: true,
		spritePath: '/sprites/stoa/thinkers/marcus.png',
		voiceSignature: 'Marcus, the emperor-philosopher, speaks with measured gravity'
	},
	{
		id: 'epictetus',
		name: 'Epictetus',
		dates: '50–135 CE',
		zone: 'sea-terrace' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/epictetus.png',
		voiceSignature: 'Epictetus, the freed slave, speaks with sharp, practical clarity'
	},
	{
		id: 'seneca',
		name: 'Seneca the Younger',
		dates: '4 BCE–65 CE',
		zone: 'shrines' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/seneca.png',
		voiceSignature: 'Seneca, the statesman-writer, speaks with elegant, urgent prose'
	},
	{
		id: 'chrysippus',
		name: 'Chrysippus of Soli',
		dates: '279–206 BCE',
		zone: 'library' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/chrysippus.png',
		voiceSignature: 'Chrysippus, the logician, speaks with precise, systematic reasoning'
	},
	{
		id: 'zeno',
		name: 'Zeno of Citium',
		dates: '334–262 BCE',
		zone: 'garden' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/zeno.png',
		voiceSignature: 'Zeno, the founder, speaks with foundational, quiet authority'
	}
];

export const STOA_THINKER_MAP: Map<string, ThinkerProfile> = new Map(
	STOA_THINKER_REGISTRY.map((t) => [t.id, t])
);

