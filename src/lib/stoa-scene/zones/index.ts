import * as THREE from 'three';
import type { StoaZone } from '$lib/types/stoa';
import { CameraController } from '../camera/controller';
import { buildColonnade } from './colonnade';
import { buildSeaTerrace } from './sea-terrace';

type ZoneBuilder = () => Promise<THREE.Group>;

interface ZoneTransitionState {
  zone: StoaZone;
  incomingGroup: THREE.Group;
  outgoingGroup: THREE.Group | null;
  incomingMaterials: THREE.Material[];
  outgoingMaterials: THREE.Material[];
  elapsed: number;
  duration: number;
  resolve: () => void;
}

const ZONE_BUILDERS: Partial<Record<StoaZone, ZoneBuilder>> = {
  colonnade: buildColonnade,
  'sea-terrace': buildSeaTerrace
};

const ZONE_CAMERA: Record<StoaZone, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  colonnade: {
    position: new THREE.Vector3(0, 3.1, 9.8),
    target: new THREE.Vector3(0, 1.5, -4.8)
  },
  'sea-terrace': {
    position: new THREE.Vector3(0, 2.6, 8.5),
    target: new THREE.Vector3(0, 1.2, -10)
  },
  shrines: {
    position: new THREE.Vector3(5.8, 2.7, 5.8),
    target: new THREE.Vector3(0, 1.4, 0)
  },
  library: {
    position: new THREE.Vector3(-6.2, 2.8, 5.4),
    target: new THREE.Vector3(0, 1.2, -1)
  },
  garden: {
    position: new THREE.Vector3(0, 3.4, 11.2),
    target: new THREE.Vector3(0, 1.1, -2.5)
  }
};

export class ZoneManager {
  private readonly scene: THREE.Scene;
  private readonly cameraController: CameraController;
  private readonly clock = new THREE.Clock();

  private activeZone: StoaZone | null = null;
  private activeGroup: THREE.Group | null = null;
  private transitionState: ZoneTransitionState | null = null;
  private transitionQueue: Promise<void> = Promise.resolve();

  public constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.cameraController = new CameraController(camera);
  }

  public async transition(zone: StoaZone): Promise<void> {
    this.transitionQueue = this.transitionQueue.then(async () => {
      await this.runTransition(zone);
    });
    await this.transitionQueue;
  }

  public async transitionTo(zone: StoaZone): Promise<void> {
    await this.transition(zone);
  }

  private async runTransition(zone: StoaZone): Promise<void> {
    if (this.activeZone === zone && !this.transitionState) {
      return;
    }

    const builder = ZONE_BUILDERS[zone] ?? buildColonnade;
    const incomingGroup = await builder();
    this.scene.add(incomingGroup);

    const incomingMaterials = this.collectMaterials(incomingGroup);
    const outgoingGroup = this.activeGroup ?? null;
    const outgoingMaterials = outgoingGroup ? this.collectMaterials(outgoingGroup) : [];

    const cameraConfig = ZONE_CAMERA[zone];
    if (!outgoingGroup) {
      this.setOpacity(incomingMaterials, 1);
      this.cameraController.setImmediate(cameraConfig.position, cameraConfig.target);
      this.activeZone = zone;
      this.activeGroup = incomingGroup;
      return;
    }

    this.setOpacity(incomingMaterials, 0);
    this.setOpacity(outgoingMaterials, 1);
    this.cameraController.transitionTo(cameraConfig.position, cameraConfig.target, 1.5);

    await new Promise<void>((resolve) => {
      this.transitionState = {
        zone,
        incomingGroup,
        outgoingGroup,
        incomingMaterials,
        outgoingMaterials,
        elapsed: 0,
        duration: 0.65,
        resolve
      };
    });
  }

  public update(): void {
    const delta = this.clock.getDelta();

    if (this.transitionState) {
      this.transitionState.elapsed += delta;
      const rawT = Math.min(this.transitionState.elapsed / this.transitionState.duration, 1);
      const easedT = this.easeInOut(rawT);

      this.setOpacity(this.transitionState.incomingMaterials, easedT);
      this.setOpacity(this.transitionState.outgoingMaterials, 1 - easedT);

      if (rawT >= 1) {
        if (this.transitionState.outgoingGroup) {
          this.disposeGroup(this.transitionState.outgoingGroup);
          this.scene.remove(this.transitionState.outgoingGroup);
        }

        this.activeZone = this.transitionState.zone;
        this.activeGroup = this.transitionState.incomingGroup;
        this.transitionState.resolve();
        this.transitionState = null;
      }
    }

    this.cameraController.update(delta);
  }

  public dispose(): void {
    if (this.transitionState) {
      this.disposeGroup(this.transitionState.incomingGroup);
      if (this.transitionState.outgoingGroup) {
        this.disposeGroup(this.transitionState.outgoingGroup);
      }

      this.scene.remove(this.transitionState.incomingGroup);
      if (this.transitionState.outgoingGroup) {
        this.scene.remove(this.transitionState.outgoingGroup);
      }
      this.transitionState.resolve();
      this.transitionState = null;
    }

    if (this.activeGroup) {
      this.disposeGroup(this.activeGroup);
      this.scene.remove(this.activeGroup);
      this.activeGroup = null;
    }

    this.activeZone = null;
  }

  private collectMaterials(group: THREE.Group): THREE.Material[] {
    const materials: THREE.Material[] = [];
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) {
        return;
      }

      if (Array.isArray(material)) {
        for (const item of material) {
          materials.push(item);
        }
      } else {
        materials.push(material);
      }
    });

    return materials;
  }

  private setOpacity(materials: THREE.Material[], opacity: number): void {
    for (const material of materials) {
      const candidate = material as THREE.Material & { opacity?: number; transparent?: boolean };
      if (typeof candidate.opacity === 'number') {
        candidate.opacity = opacity;
        candidate.transparent = opacity < 1;
      }
    }
  }

  private disposeGroup(group: THREE.Group): void {
    const disposeFromUserData = group.userData.dispose;
    if (typeof disposeFromUserData === 'function') {
      (disposeFromUserData as () => void)();
      return;
    }

    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }

      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (material) {
        if (Array.isArray(material)) {
          for (const item of material) {
            item.dispose();
          }
        } else {
          material.dispose();
        }
      }
    });
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
