import * as THREE from 'three';

interface CameraTransitionState {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  duration: number;
  elapsed: number;
}

export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private currentTarget = new THREE.Vector3(0, 1.6, -4.5);
  private basePosition = new THREE.Vector3(0, 3.1, 9.8);
  private breathingTime = 0;
  private transition: CameraTransitionState | null = null;

  public constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.copy(this.basePosition);
    this.camera.lookAt(this.currentTarget);
  }

  public transitionTo(position: THREE.Vector3, lookAt: THREE.Vector3, duration = 1.5): void {
    this.transition = {
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.currentTarget.clone(),
      toTarget: lookAt.clone(),
      duration: Math.max(duration, 0.01),
      elapsed: 0
    };
  }

  public update(deltaSeconds: number): void {
    const delta = Math.max(deltaSeconds, 0);
    this.breathingTime += delta;

    if (this.transition) {
      this.transition.elapsed += delta;
      const rawT = Math.min(this.transition.elapsed / this.transition.duration, 1);
      const easedT = this.easeInOutPower2(rawT);

      this.basePosition.lerpVectors(this.transition.fromPosition, this.transition.toPosition, easedT);
      this.currentTarget.lerpVectors(this.transition.fromTarget, this.transition.toTarget, easedT);

      if (rawT >= 1) {
        this.transition = null;
      }
    }

    const breathingOffset = Math.sin(this.breathingTime * 0.82) * 0.02;
    this.camera.position.set(this.basePosition.x, this.basePosition.y + breathingOffset, this.basePosition.z);
    this.camera.lookAt(this.currentTarget);
  }

  public setImmediate(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.basePosition.copy(position);
    this.currentTarget.copy(lookAt);
    this.camera.position.copy(position);
    this.camera.lookAt(lookAt);
  }

  private easeInOutPower2(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
