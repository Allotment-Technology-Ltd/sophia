import * as THREE from 'three';
import { createColumns } from '../objects/columns';
import { createStoaSprite } from '../objects/stoa-sprite';
import { DayCycle } from '../systems/day-cycle';
import { TorchParticleSystem } from '../systems/particles';

type DisposeFn = () => void;
type UpdateFn = (delta: number, hour?: number) => void;

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

export async function buildColonnade(scene?: THREE.Scene): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'stoa-zone-colonnade';

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 24),
    new THREE.MeshStandardMaterial({
      color: '#e8e0d0',
      roughness: 0.34,
      metalness: 0.05
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const columns = createColumns({ count: 12, spacing: 3.2, height: 4.4 });
  group.add(columns);

  const stoa = await createStoaSprite({ size: 3.2 });
  stoa.position.set(0, 0, -5.8);
  group.add(stoa);

  const ambient = new THREE.AmbientLight('#87ceeb', 0.28);
  group.add(ambient);

  const sun = new THREE.DirectionalLight('#ffd4a0', 1.35);
  sun.position.set(9, 16, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 50;
  group.add(sun);

  const torchLeft = new THREE.PointLight('#ff8c42', 1.3, 10);
  torchLeft.position.set(-6.5, 3.2, -4.8);
  group.add(torchLeft);

  const torchRight = new THREE.PointLight('#ff8c42', 1.3, 10);
  torchRight.position.set(6.5, 3.2, -4.8);
  group.add(torchRight);

  const torchParticles = new TorchParticleSystem([torchLeft.position, torchRight.position], {
    perTorch: 20
  });
  const particlesGroup = torchParticles.getObject3D();
  group.add(particlesGroup);

  const dayCycle = scene ? new DayCycle(ambient, sun, scene, { defaultHour: 18 }) : null;
  let currentHour = 18;
  const update: UpdateFn = (delta, hour = 18) => {
    torchParticles.update(delta);
    if (dayCycle && Math.abs(hour - currentHour) > 0.001) {
      currentHour = hour;
      dayCycle.update(hour);
    }
  };
  group.userData.update = update;
  group.userData.setTimeOfDay = (hour: number) => {
    if (dayCycle) {
      currentHour = hour;
      dayCycle.setHour(hour);
    }
  };

  const dispose: DisposeFn = () => {
    group.remove(particlesGroup);
    torchParticles.dispose();
    disposeObject3D(group);
  };
  group.userData.dispose = dispose;

  return group;
}
