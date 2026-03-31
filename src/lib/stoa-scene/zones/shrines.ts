import * as THREE from 'three';

interface AlcoveThinker {
	id: string;
	name: string;
	spritePath: string;
}

const THINKERS: AlcoveThinker[] = [
	{ id: 'marcus', name: 'Marcus Aurelius', spritePath: '/sprites/stoa/thinkers/marcus.png' },
	{ id: 'epictetus', name: 'Epictetus', spritePath: '/sprites/stoa/thinkers/epictetus.png' },
	{ id: 'seneca', name: 'Seneca the Younger', spritePath: '/sprites/stoa/thinkers/seneca.png' },
	{ id: 'chrysippus', name: 'Chrysippus of Soli', spritePath: '/sprites/stoa/thinkers/chrysippus.png' },
	{ id: 'zeno', name: 'Zeno of Citium', spritePath: '/sprites/stoa/thinkers/zeno.png' }
];

type DisposeFn = () => void;

function disposeMaterial(material: THREE.Material): void {
	const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap'] as const;
	const candidate = material as unknown as Record<string, unknown>;

	for (const key of textureKeys) {
		const value = candidate[key];
		if (value instanceof THREE.Texture) {
			value.dispose();
		}
	}

	material.dispose();
}

function disposeObject3D(root: THREE.Object3D): void {
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (mesh.geometry) {
			mesh.geometry.dispose();
		}

		const sprite = object as THREE.Sprite;
		const spriteMaterial = sprite.material;
		if (spriteMaterial && !Array.isArray(spriteMaterial)) {
			const texture = spriteMaterial.map;
			if (texture) {
				texture.dispose();
			}
			spriteMaterial.dispose();
		}

		const material = (mesh.material ?? null) as THREE.Material | THREE.Material[] | null;
		if (material) {
			if (Array.isArray(material)) {
				for (const item of material) {
					disposeMaterial(item);
				}
			} else {
				disposeMaterial(material);
			}
		}
	});
}

function createSilhouetteTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 384;
	const ctx = canvas.getContext('2d');

	if (ctx) {
		ctx.fillStyle = '#2a2a2a';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#555555';
		ctx.beginPath();
		ctx.arc(128, 112, 52, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#444444';
		ctx.fillRect(88, 170, 80, 146);
		ctx.fillStyle = '#333333';
		ctx.fillRect(42, 324, 172, 20);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createNameplateTexture(text: string, isUnlocked: boolean): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');

	if (ctx) {
		ctx.fillStyle = isUnlocked ? '#3d3429' : '#2a2520';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.strokeStyle = isUnlocked ? '#8b7355' : '#555555';
		ctx.lineWidth = 4;
		ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

		ctx.font = 'bold 48px "Cormorant Garamond", Georgia, serif';
		ctx.fillStyle = isUnlocked ? '#e8dcc8' : '#888888';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, canvas.width / 2, canvas.height / 2);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

async function loadThinkerSprite(spritePath: string): Promise<THREE.Texture> {
	const loader = new THREE.TextureLoader();
	const texture = await loader.loadAsync(spritePath);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function createAlcove(
	thinker: AlcoveThinker,
	index: number,
	isUnlocked: boolean,
	spriteTexture: THREE.Texture | null
): THREE.Group {
	const group = new THREE.Group();
	const xPos = (index - 2) * 6.5;
	group.position.set(xPos, 0, -3);

	const recess = new THREE.Mesh(
		new THREE.BoxGeometry(5, 6, 2),
		new THREE.MeshStandardMaterial({
			color: '#4a4339',
			roughness: 0.9,
			metalness: 0.05
		})
	);
	recess.position.set(0, 3, -1);
	recess.receiveShadow = true;
	group.add(recess);

	const plinth = new THREE.Mesh(
		new THREE.BoxGeometry(2.4, 1.2, 1.8),
		new THREE.MeshStandardMaterial({
			color: '#e8e0d5',
			roughness: 0.3,
			metalness: 0.1
		})
	);
	plinth.position.set(0, 0.6, 0);
	plinth.castShadow = true;
	plinth.receiveShadow = true;
	group.add(plinth);

	const spriteMaterial = new THREE.SpriteMaterial({
		map: isUnlocked && spriteTexture ? spriteTexture : createSilhouetteTexture(),
		color: isUnlocked ? '#ffffff' : '#888888',
		transparent: true,
		opacity: isUnlocked ? 1 : 0.6,
		depthWrite: false
	});

	const sprite = new THREE.Sprite(spriteMaterial);
	sprite.center.set(0.5, 0);
	sprite.scale.set(2.1, 2.8, 1);
	sprite.position.set(0, 1.2, 0.2);
	sprite.userData.thinkerId = thinker.id;
	sprite.userData.isInteractable = isUnlocked;
	group.add(sprite);

	const lampGroup = new THREE.Group();
	lampGroup.position.set(0, 5.5, 0.8);

	const lampHousing = new THREE.Mesh(
		new THREE.SphereGeometry(0.25, 16, 16),
		new THREE.MeshStandardMaterial({
			color: '#8b4513',
			roughness: 0.6,
			metalness: 0.4
		})
	);
	lampHousing.castShadow = true;
	lampGroup.add(lampHousing);

	if (isUnlocked) {
		const lampLight = new THREE.PointLight('#ff8c42', 1.5, 8);
		lampLight.position.set(0, -0.3, 0);
		lampLight.castShadow = true;
		lampLight.shadow.mapSize.set(512, 512);
		lampGroup.add(lampLight);

		const lampGlow = new THREE.Mesh(
			new THREE.SphereGeometry(0.15, 8, 8),
			new THREE.MeshBasicMaterial({
				color: '#ffaa55',
				transparent: true,
				opacity: 0.8
			})
		);
		lampGlow.position.set(0, -0.3, 0);
		lampGroup.add(lampGlow);
	}

	group.add(lampGroup);

	const nameplateTexture = createNameplateTexture(
		isUnlocked ? thinker.name : '???',
		isUnlocked
	);
	const nameplateMaterial = new THREE.SpriteMaterial({
		map: nameplateTexture,
		transparent: true,
		depthWrite: false
	});
	const nameplate = new THREE.Sprite(nameplateMaterial);
	nameplate.center.set(0.5, 0.5);
	nameplate.scale.set(2.8, 0.7, 1);
	nameplate.position.set(0, 4.2, 0.3);
	group.add(nameplate);

	group.userData.thinkerId = thinker.id;
	group.userData.isUnlocked = isUnlocked;

	return group;
}

function setupClickDetection(
	group: THREE.Group,
	_scene: THREE.Scene,
	canvas: HTMLCanvasElement,
	camera: THREE.PerspectiveCamera
): () => void {
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	let isDestroyed = false;

	const handleClick = (event: MouseEvent): void => {
		if (isDestroyed) return;

		const rect = canvas.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		raycaster.setFromCamera(mouse, camera);

		const sprites: THREE.Sprite[] = [];
		group.traverse((object) => {
			if (object instanceof THREE.Sprite && object.userData.isInteractable) {
				sprites.push(object);
			}
		});

		const intersects = raycaster.intersectObjects(sprites);
		if (intersects.length > 0) {
			const target = intersects[0].object;
			const thinkerId = target.userData.thinkerId as string | undefined;
			if (thinkerId) {
				const customEvent = new CustomEvent('thinkerSelected', {
					detail: { thinkerId },
					bubbles: true
				});
				window.dispatchEvent(customEvent);
			}
		}
	};

	window.addEventListener('click', handleClick);

	return () => {
		isDestroyed = true;
		window.removeEventListener('click', handleClick);
	};
}

export async function buildShrines(unlockedThinkers: string[]): Promise<THREE.Group> {
	const group = new THREE.Group();
	group.name = 'stoa-zone-shrines';

	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(38, 18),
		new THREE.MeshStandardMaterial({
			color: '#d5cbb8',
			roughness: 0.4,
			metalness: 0.05
		})
	);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	group.add(floor);

	const ambient = new THREE.AmbientLight('#6b5d4d', 0.35);
	group.add(ambient);

	const torchLeft = new THREE.PointLight('#ff8c42', 0.8, 12);
	torchLeft.position.set(-14, 3.5, -2);
	group.add(torchLeft);

	const torchRight = new THREE.PointLight('#ff8c42', 0.8, 12);
	torchRight.position.set(14, 3.5, -2);
	group.add(torchRight);

	const alcovePromises = THINKERS.map(async (thinker, index) => {
		const isUnlocked = unlockedThinkers.includes(thinker.id);
		let spriteTexture: THREE.Texture | null = null;

		if (isUnlocked) {
			try {
				spriteTexture = await loadThinkerSprite(thinker.spritePath);
			} catch {
				spriteTexture = null;
			}
		}

		const alcove = createAlcove(thinker, index, isUnlocked, spriteTexture);
		group.add(alcove);
	});

	await Promise.all(alcovePromises);

	const dispose: DisposeFn = () => {
		disposeObject3D(group);
	};
	group.userData.dispose = dispose;

	return group;
}

export function setupShrinesClickDetection(
	group: THREE.Group,
	scene: THREE.Scene,
	canvas: HTMLCanvasElement,
	camera: THREE.PerspectiveCamera
): () => void {
	return setupClickDetection(group, scene, canvas, camera);
}
