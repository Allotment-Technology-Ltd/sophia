import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StoaZone, WorldMapNode, WorldMapResponse } from '$lib/types/stoa';
import { ZoneManager } from './zones';

export class StoaScene extends EventTarget {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly zoneManager: ZoneManager;
  private readonly controls: OrbitControls;
  private animationFrameId: number | null = null;
  private readonly pointer = new THREE.Vector2();
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerMove: (event: PointerEvent) => void;

  public constructor(canvas: HTMLCanvasElement) {
    super();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#6f8aa0');
    this.scene.fog = new THREE.Fog('#89a7bc', 26, 92);

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
    this.zoneManager = new ZoneManager(this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 34;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0, 0);

    this.onPointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

      const picked = this.zoneManager.pick(this.pointer, this.camera);
      if (picked?.type === 'thinker') {
        this.dispatchEvent(
          new CustomEvent<{ thinkerId: string }>('thinkerSelected', {
            detail: { thinkerId: picked.thinkerId }
          })
        );
      }
      if (picked?.type === 'world-map-node') {
        this.dispatchEvent(
          new CustomEvent<{ node: WorldMapNode }>('worldMapNodeSelected', {
            detail: { node: picked.node }
          })
        );
      }
    };
    this.onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      this.zoneManager.hover(this.pointer, this.camera);
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
  }

  public async loadZone(zone: StoaZone): Promise<void> {
    await this.zoneManager.transition(zone);
    const worldMapActive = zone === 'world-map';
    this.controls.enabled = worldMapActive;
    if (worldMapActive) {
      this.controls.target.set(0, 0, 0);
    }
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < 768 ? 75 : 60;
    this.camera.updateProjectionMatrix();
  }

  public setUnlockedThinkers(unlockedThinkers: string[]): void {
    this.zoneManager.setUnlockedThinkers(unlockedThinkers);
  }

  public setWorldMapData(data: WorldMapResponse): void {
    this.zoneManager.setWorldMapData(data);
  }

  public setWorldMapSelection(nodeId: string | null): void {
    this.zoneManager.setWorldMapSelection(nodeId);
  }

  public illuminateShrine(thinkerId: string): void {
    this.zoneManager.illuminateShrine(thinkerId);
  }

  public setTimeOfDay(hour: number): void {
    this.zoneManager.setTimeOfDay(hour);
  }

  public start(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    const animate = (): void => {
      this.animationFrameId = requestAnimationFrame(animate);
      this.zoneManager.update();
      if (this.controls.enabled) {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  public destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.zoneManager.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
