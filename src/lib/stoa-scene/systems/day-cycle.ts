import * as THREE from 'three';

interface DayCycleState {
  hour: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunDirection: THREE.Vector3;
  skyColor: THREE.Color;
  fogColor: THREE.Color;
}

interface DayCycleOptions {
  defaultHour?: number;
}

const DAY_CYCLE_ANCHORS: DayCycleState[] = [
  {
    hour: 6,
    ambientColor: new THREE.Color('#d59ba0'),
    ambientIntensity: 0.25,
    sunColor: new THREE.Color('#ffb78d'),
    sunIntensity: 0.7,
    sunDirection: new THREE.Vector3(-12, 6, 9),
    skyColor: new THREE.Color('#b9868e'),
    fogColor: new THREE.Color('#a57c83')
  },
  {
    hour: 12,
    ambientColor: new THREE.Color('#dce9f7'),
    ambientIntensity: 0.42,
    sunColor: new THREE.Color('#fff6dd'),
    sunIntensity: 1.35,
    sunDirection: new THREE.Vector3(2, 20, 1),
    skyColor: new THREE.Color('#7eb7e6'),
    fogColor: new THREE.Color('#a8cee8')
  },
  {
    hour: 18,
    ambientColor: new THREE.Color('#b58a76'),
    ambientIntensity: 0.3,
    sunColor: new THREE.Color('#ffcb98'),
    sunIntensity: 1.0,
    sunDirection: new THREE.Vector3(10, 9, 6),
    skyColor: new THREE.Color('#6e6f8a'),
    fogColor: new THREE.Color('#8b7f86')
  },
  {
    hour: 22,
    ambientColor: new THREE.Color('#274268'),
    ambientIntensity: 0.15,
    sunColor: new THREE.Color('#5f7fb8'),
    sunIntensity: 0.2,
    sunDirection: new THREE.Vector3(-6, 4, -8),
    skyColor: new THREE.Color('#11182a'),
    fogColor: new THREE.Color('#24334a')
  }
];

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) {
    return 18;
  }
  const wrapped = hour % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}

export class DayCycle {
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly scene: THREE.Scene;
  private currentHour: number;

  public constructor(
    ambient: THREE.AmbientLight,
    sun: THREE.DirectionalLight,
    scene: THREE.Scene,
    options: DayCycleOptions = {}
  ) {
    this.ambient = ambient;
    this.sun = sun;
    this.scene = scene;
    this.currentHour = clampHour(options.defaultHour ?? 18);
    this.update(this.currentHour);
  }

  public setHour(hour: number): void {
    this.currentHour = clampHour(hour);
    this.update(this.currentHour);
  }

  public update(hour: number): void {
    this.currentHour = clampHour(hour);

    const state = this.sampleState(this.currentHour);
    this.ambient.color.copy(state.ambientColor);
    this.ambient.intensity = state.ambientIntensity;
    this.sun.color.copy(state.sunColor);
    this.sun.intensity = state.sunIntensity;
    this.sun.position.copy(state.sunDirection);

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(state.skyColor);
    } else {
      this.scene.background = state.skyColor.clone();
    }

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(state.fogColor);
    } else {
      this.scene.fog = new THREE.Fog(state.fogColor.clone(), 24, 92);
    }
  }

  private sampleState(hour: number): DayCycleState {
    const firstAnchorHour = DAY_CYCLE_ANCHORS[0]?.hour ?? 6;
    const wrapHour = hour < firstAnchorHour ? hour + 24 : hour;
    const wrappedAnchors = DAY_CYCLE_ANCHORS.map((state) => ({
      ...state,
      hour: state.hour < firstAnchorHour ? state.hour + 24 : state.hour
    }));

    let start = wrappedAnchors[0];
    let end = wrappedAnchors[1];
    for (let index = 0; index < wrappedAnchors.length - 1; index += 1) {
      const candidateStart = wrappedAnchors[index];
      const candidateEnd = wrappedAnchors[index + 1];
      if (wrapHour >= candidateStart.hour && wrapHour <= candidateEnd.hour) {
        start = candidateStart;
        end = candidateEnd;
        break;
      }
    }

    if (wrapHour > wrappedAnchors[wrappedAnchors.length - 1].hour) {
      start = wrappedAnchors[wrappedAnchors.length - 1];
      end = { ...wrappedAnchors[0], hour: wrappedAnchors[0].hour + 24 };
    }

    const span = Math.max(end.hour - start.hour, 0.0001);
    const t = THREE.MathUtils.smoothstep((wrapHour - start.hour) / span, 0, 1);

    return {
      hour,
      ambientColor: start.ambientColor.clone().lerp(end.ambientColor, t),
      ambientIntensity: THREE.MathUtils.lerp(start.ambientIntensity, end.ambientIntensity, t),
      sunColor: start.sunColor.clone().lerp(end.sunColor, t),
      sunIntensity: THREE.MathUtils.lerp(start.sunIntensity, end.sunIntensity, t),
      sunDirection: start.sunDirection.clone().lerp(end.sunDirection, t),
      skyColor: start.skyColor.clone().lerp(end.skyColor, t),
      fogColor: start.fogColor.clone().lerp(end.fogColor, t)
    };
  }
}
