import * as THREE from 'three';

interface TorchParticleSystemOptions {
  perTorch?: number;
}

interface ParticleState {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  age: number;
  life: number;
  drift: THREE.Vector3;
  scale: number;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class TorchParticleSystem {
  private readonly group = new THREE.Group();
  private readonly particles: ParticleState[] = [];
  private readonly sharedGeometry = new THREE.SphereGeometry(0.02, 6, 6);
  private readonly perTorch: number;
  private disposed = false;
  private readonly scratch = new THREE.Vector3();

  public constructor(torchPositions: THREE.Vector3[], options: TorchParticleSystemOptions = {}) {
    this.perTorch = options.perTorch ?? 20;
    this.group.name = 'stoa-torch-particles';

    for (const torchPosition of torchPositions) {
      for (let index = 0; index < this.perTorch; index += 1) {
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(randomInRange(0.08, 0.14), 0.95, randomInRange(0.45, 0.62)),
          transparent: true,
          opacity: randomInRange(0.45, 0.92),
          depthWrite: false
        });
        const mesh = new THREE.Mesh(this.sharedGeometry, material);
        mesh.frustumCulled = true;
        this.group.add(mesh);

        const particle: ParticleState = {
          mesh,
          base: torchPosition.clone(),
          age: 0,
          life: randomInRange(0.9, 1.8),
          drift: new THREE.Vector3(
            randomInRange(-0.12, 0.12),
            randomInRange(0.36, 0.72),
            randomInRange(-0.12, 0.12)
          ),
          scale: randomInRange(0.75, 1.35)
        };
        this.resetParticle(particle, true);
        this.particles.push(particle);
      }
    }
  }

  public getObject3D(): THREE.Group {
    return this.group;
  }

  public update(delta: number): void {
    if (this.disposed) {
      return;
    }

    for (const particle of this.particles) {
      particle.age += delta;
      if (particle.age >= particle.life) {
        this.resetParticle(particle, false);
        continue;
      }

      const t = particle.age / particle.life;
      const sway = Math.sin((particle.age * 6) + particle.base.x * 0.7) * 0.04;
      this.scratch.copy(particle.drift).multiplyScalar(delta);
      particle.mesh.position.add(this.scratch);
      particle.mesh.position.x += sway * delta;
      particle.mesh.position.z += Math.cos((particle.age * 5) + particle.base.z * 0.5) * 0.02 * delta;

      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - t) * 0.9;
      const scale = particle.scale * (0.75 + t * 0.35);
      particle.mesh.scale.setScalar(scale);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const particle of this.particles) {
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.dispose();
    }
    this.sharedGeometry.dispose();
    this.particles.length = 0;
  }

  private resetParticle(particle: ParticleState, initialSpawn: boolean): void {
    particle.age = initialSpawn ? randomInRange(0, particle.life) : 0;
    particle.life = randomInRange(0.9, 1.8);
    particle.drift.set(
      randomInRange(-0.12, 0.12),
      randomInRange(0.36, 0.72),
      randomInRange(-0.12, 0.12)
    );
    particle.scale = randomInRange(0.75, 1.35);

    particle.mesh.position.set(
      particle.base.x + randomInRange(-0.06, 0.06),
      particle.base.y + randomInRange(-0.08, 0.02),
      particle.base.z + randomInRange(-0.06, 0.06)
    );
  }
}
