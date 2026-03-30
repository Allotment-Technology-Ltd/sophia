import * as THREE from 'three';
import type { StoaZone } from '$lib/types/stoa';
import type { WorldMapNode, WorldMapEdge } from '$lib/types/stoa';
import { CameraController } from '../camera/controller';
import { buildColonnade } from './colonnade';
import { buildShrines } from './shrines';
import { buildSeaTerrace } from './sea-terrace';
import { buildWorldMap } from './world-map';

interface ZoneBuilderContext {
  unlockedThinkers: string[];
  scene: THREE.Scene;
  worldMapData: {
    nodes: WorldMapNode[];
    edges: WorldMapEdge[];
  };
}

type ZoneBuilder = (context: ZoneBuilderContext) => Promise<THREE.Group>;
type ZoneUpdateFn = (delta: number, hour?: number, elapsed?: number) => void;
type ZoneTimeSetterFn = (hour: number) => void;

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
  colonnade: async (context) => buildColonnade(context.scene),
  'sea-terrace': async () => buildSeaTerrace(),
  shrines: async (context) => buildShrines(context.unlockedThinkers),
  'world-map': async (context) => buildWorldMap(context.worldMapData)
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
  },
  'world-map': {
    position: new THREE.Vector3(0, 11.5, 15.5),
    target: new THREE.Vector3(0, 0, 0)
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
  private unlockedThinkers: string[] = ['marcus'];
  private worldMapData: { nodes: WorldMapNode[]; edges: WorldMapEdge[] } = { nodes: [], edges: [] };
  private shrinesVersion = 0;
  private renderedShrinesVersion = -1;
  private worldMapVersion = 0;
  private renderedWorldMapVersion = -1;
  private elapsed = 0;
  private timeOfDayHour = 18;

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

  public setUnlockedThinkers(unlockedThinkers: string[]): void {
    const next = [...new Set(unlockedThinkers)];
    const current = [...this.unlockedThinkers];
    next.sort();
    current.sort();

    const changed =
      next.length !== current.length || next.some((value, index) => value !== current[index]);
    if (!changed) {
      return;
    }

    this.unlockedThinkers = [...new Set(unlockedThinkers)];
    this.shrinesVersion += 1;
  }

  public setWorldMapData(data: { nodes: WorldMapNode[]; edges: WorldMapEdge[] }): void {
    const normalizedNodes = Array.isArray(data.nodes) ? data.nodes : [];
    const normalizedEdges = Array.isArray(data.edges) ? data.edges : [];
    this.worldMapData = {
      nodes: normalizedNodes,
      edges: normalizedEdges
    };
    this.worldMapVersion += 1;
  }

  private async runTransition(zone: StoaZone): Promise<void> {
    const shouldRebuildShrines =
      zone === 'shrines' && this.renderedShrinesVersion !== this.shrinesVersion;
    const shouldRebuildWorldMap =
      zone === 'world-map' && this.renderedWorldMapVersion !== this.worldMapVersion;
    if (this.activeZone === zone && !this.transitionState && !shouldRebuildShrines && !shouldRebuildWorldMap) {
      return;
    }

    const builder = ZONE_BUILDERS[zone] ?? (async (context) => buildColonnade(context.scene));
    const incomingGroup = await builder({
      unlockedThinkers: this.unlockedThinkers,
      scene: this.scene,
      worldMapData: this.worldMapData
    });
    this.scene.add(incomingGroup);
    this.applyTimeOfDay(incomingGroup);

    const incomingMaterials = this.collectMaterials(incomingGroup);
    const outgoingGroup = this.activeGroup ?? null;
    const outgoingMaterials = outgoingGroup ? this.collectMaterials(outgoingGroup) : [];

    const cameraConfig = ZONE_CAMERA[zone];
    if (!outgoingGroup) {
      this.setOpacity(incomingMaterials, 1);
      this.cameraController.setImmediate(cameraConfig.position, cameraConfig.target);
      this.activeZone = zone;
      this.activeGroup = incomingGroup;
      if (zone === 'shrines') {
        this.renderedShrinesVersion = this.shrinesVersion;
      }
      if (zone === 'world-map') {
        this.renderedWorldMapVersion = this.worldMapVersion;
      }
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
    this.elapsed += delta;

    if (this.transitionState) {
      this.updateGroup(this.transitionState.incomingGroup, delta);
      if (this.transitionState.outgoingGroup) {
        this.updateGroup(this.transitionState.outgoingGroup, delta);
      }

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
        if (this.transitionState.zone === 'shrines') {
          this.renderedShrinesVersion = this.shrinesVersion;
        }
        if (this.transitionState.zone === 'world-map') {
          this.renderedWorldMapVersion = this.worldMapVersion;
        }
        this.transitionState.resolve();
        this.transitionState = null;
      }
    }
    if (!this.transitionState && this.activeGroup) {
      this.updateGroup(this.activeGroup, delta);
    }

    const cameraOverride = Boolean(this.activeGroup?.userData?.cameraOverride);
    if (!cameraOverride || this.transitionState) {
      this.cameraController.update(delta);
    }
  }

  public setTimeOfDay(hour: number): void {
    if (!Number.isFinite(hour)) {
      return;
    }
    this.timeOfDayHour = ((hour % 24) + 24) % 24;
    if (this.activeGroup) {
      this.applyTimeOfDay(this.activeGroup);
    }
    if (this.transitionState) {
      this.applyTimeOfDay(this.transitionState.incomingGroup);
      if (this.transitionState.outgoingGroup) {
        this.applyTimeOfDay(this.transitionState.outgoingGroup);
      }
    }
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

  public hover(pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera): void {
    if (!this.activeGroup) {
      return;
    }
    const hover = this.activeGroup.userData.hover as
      | ((pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera) => void)
      | undefined;
    if (typeof hover === 'function') {
      hover(pointerNdc, camera);
    }
  }

  public pick(
    pointerNdc: THREE.Vector2,
    camera: THREE.PerspectiveCamera
  ): { type: 'thinker'; thinkerId: string } | { type: 'world-map-node'; node: WorldMapNode } | null {
    if (!this.activeGroup) {
      return null;
    }

    const zonePick = this.activeGroup.userData.pick as
      | ((pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera) => {
          node: WorldMapNode;
          focus: { position: THREE.Vector3; target: THREE.Vector3 };
        } | null)
      | undefined;
    if (typeof zonePick === 'function') {
      const selected = zonePick(pointerNdc, camera);
      if (selected) {
        this.cameraController.transitionTo(selected.focus.position, selected.focus.target, 0.72);
        return { type: 'world-map-node', node: selected.node };
      }
    }

    if (this.activeZone !== 'shrines') {
      return null;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointerNdc, camera);
    const intersections = raycaster.intersectObject(this.activeGroup, true);

    for (const intersection of intersections) {
      let current: THREE.Object3D | null = intersection.object;
      while (current) {
        const thinkerId = current.userData?.thinkerId;
        const unlocked = current.userData?.unlocked;
        if (typeof thinkerId === 'string' && unlocked === true) {
          return { type: 'thinker', thinkerId };
        }
        current = current.parent;
      }
    }

    return null;
  }

  public illuminateShrine(thinkerId: string): void {
    if (!this.activeGroup || this.activeZone !== 'shrines') {
      return;
    }

    this.activeGroup.traverse((object) => {
      let current: THREE.Object3D | null = object;
      let belongsToThinker = false;
      while (current) {
        if (current.userData?.thinkerId === thinkerId) {
          belongsToThinker = true;
          break;
        }
        current = current.parent;
      }
      if (!belongsToThinker) {
        return;
      }

      if (object instanceof THREE.PointLight) {
        object.intensity = Math.max(object.intensity, 0.95);
        object.color.set('#ffad57');
      }

      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      if (object.userData?.shrineElement !== 'lamp-shell') {
        return;
      }

      const material = object.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set('#9c6024');
        material.emissiveIntensity = Math.max(material.emissiveIntensity, 1.2);
        material.needsUpdate = true;
      }
    });
  }

  public setWorldMapSelection(nodeId: string | null): void {
    if (!this.activeGroup || this.activeZone !== 'world-map') {
      return;
    }
    const setSelection = this.activeGroup.userData.setSelection as
      | ((selectedId: string | null) => void)
      | undefined;
    if (typeof setSelection === 'function') {
      setSelection(nodeId);
    }
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

  private updateGroup(group: THREE.Group, delta: number): void {
    const update = group.userData.update as ZoneUpdateFn | undefined;
    if (typeof update === 'function') {
      update(delta, this.timeOfDayHour, this.elapsed);
    }
  }

  private applyTimeOfDay(group: THREE.Group): void {
    const setTimeOfDay = group.userData.setTimeOfDay as ZoneTimeSetterFn | undefined;
    if (typeof setTimeOfDay === 'function') {
      setTimeOfDay(this.timeOfDayHour);
    }
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
