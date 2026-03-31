import * as THREE from 'three';
import type { StoaZone } from '$lib/types/stoa';
import { ZoneManager } from './zones';

export class StoaScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly zoneManager: ZoneManager;
  private animationFrameId: number | null = null;

  public constructor(canvas: HTMLCanvasElement) {
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
  }

  public async loadZone(zone: StoaZone): Promise<void> {
    await this.zoneManager.transition(zone);
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

  public start(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    const animate = (): void => {
      this.animationFrameId = requestAnimationFrame(animate);
      this.zoneManager.update();
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
    this.renderer.dispose();
  }
}
