import * as THREE from 'three';
import { waterFragmentShader, waterVertexShader } from '../shaders/water.glsl';

type DisposeFn = () => void;
type UpdateFn = (delta: number) => void;

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

export async function buildSeaTerrace(): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'stoa-zone-sea-terrace';

  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 28),
    new THREE.MeshStandardMaterial({
      color: '#d5c9ad',
      roughness: 0.55,
      metalness: 0.07
    })
  );
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  group.add(deck);

  const waterUniforms = {
    uTime: { value: 0 },
    uWaveHeight: { value: 0.05 },
    uDeepColor: { value: new THREE.Color('#1E5F74') },
    uShallowColor: { value: new THREE.Color('#4ECDC4') }
  };

  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide
  });

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24, 80, 56),
    waterMaterial
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.02, -18);
  group.add(water);

  const ambient = new THREE.AmbientLight('#9bc8e6', 0.4);
  group.add(ambient);

  const sun = new THREE.DirectionalLight('#ffe1bb', 1.2);
  sun.position.set(7, 14, 4);
  sun.castShadow = true;
  group.add(sun);

  let elapsed = 0;
  const update: UpdateFn = (delta) => {
    elapsed += delta;
    waterUniforms.uTime.value = elapsed;
  };
  group.userData.update = update;

  const dispose: DisposeFn = () => {
    disposeObject3D(group);
  };
  group.userData.dispose = dispose;

  return group;
}
