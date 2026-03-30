// @ts-nocheck — three.js r183 typings conflict with this repo's TS config; runtime is correct.
import * as THREE from 'three';
import { gsap } from 'gsap';
import {
  DIALECTICAL_TRIANGLE_SVG as V,
  DIALECTICAL_EDGE_LEN as L,
  svgPointToThree,
  LOGO_COLORS,
} from './dialecticalTriangleGeometry';

const SCALE = 0.0104;

function p(svgX: number, svgY: number): THREE.Vector3 {
  const t = svgPointToThree(svgX, svgY, SCALE);
  return new THREE.Vector3(t.x, t.y, t.z);
}

export interface CaveLandingSceneApi {
  destroy: () => void;
  setHovered: (v: boolean) => void;
  setScrollProgress: (progress: number) => void;
  setChapter: (chapter: number) => void;
  setIntensity: (intensity: number) => void;
}

/**
 * Full-screen Plato cave: dramatic top light, volumetric hint, exact logo topology in 3D.
 */
export async function createCaveLandingScene(container: HTMLElement): Promise<CaveLandingSceneApi> {
  const width = container.clientWidth;
  const height = container.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(LOGO_COLORS.caveDeep, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050604, 0.072);

  const camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 80);
  camera.position.set(0, 0.14, 2.55);
  camera.lookAt(0, -0.02, 0);

  // ── Cave light rig (dramatic chiaroscuro) ─────────────────────────────
  const hemi = new THREE.HemisphereLight(LOGO_COLORS.biolume, 0x020201, 0.12);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const key = new THREE.SpotLight(LOGO_COLORS.biolume, 2.6, 14, 0.36, 0.55, 1.2);
  key.position.set(0.15, 2.35, 0.45);
  key.target.position.set(0, -0.12, 0);
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(LOGO_COLORS.sage, 0.16);
  rim.position.set(-1.2, 0.6, 0.8);
  scene.add(rim);

  const fill = new THREE.PointLight(LOGO_COLORS.blue, 0.24, 8);
  fill.position.set(-0.8, -0.2, 0.6);
  scene.add(fill);

  // Volumetric cone (fake god-ray): wide soft beam from cave mouth
  const beamGeom = new THREE.ConeGeometry(1.45, 3.2, 48, 1, true);
  beamGeom.rotateX(Math.PI);
  const beamMat = new THREE.MeshBasicMaterial({
    color: LOGO_COLORS.biolume,
    transparent: true,
    opacity: 0.044,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  beam.position.set(-0.1, 1.25, -0.2);
  beam.rotation.z = 0.08;
  scene.add(beam);

  // Ground mist plane
  const mistGeom = new THREE.PlaneGeometry(14, 14);
  const mistMat = new THREE.MeshBasicMaterial({
    color: LOGO_COLORS.mist,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
  });
  const mist = new THREE.Mesh(mistGeom, mistMat);
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = -0.95;
  scene.add(mist);

  // ── Logo root: exact SVG topology (analysis→critique→synthesis + internals) ──
  const logo = new THREE.Group();
  logo.rotation.x = THREE.MathUtils.degToRad(14);
  logo.rotation.y = THREE.MathUtils.degToRad(5.5);
  scene.add(logo);

  const A = p(V.analysis.x, V.analysis.y);
  const C = p(V.critique.x, V.critique.y);
  const S = p(V.synthesis.x, V.synthesis.y);
  const O = p(V.center.x, V.center.y);

  type EdgeSpec = { a: THREE.Vector3; b: THREE.Vector3; color: number; len: number; key: string };

  const outer: EdgeSpec[] = [
    { a: A.clone(), b: C.clone(), color: LOGO_COLORS.sage, len: L.LEN_AC, key: 'ac' },
    { a: C.clone(), b: S.clone(), color: LOGO_COLORS.copper, len: L.LEN_CS, key: 'cs' },
    { a: S.clone(), b: A.clone(), color: LOGO_COLORS.blue, len: L.LEN_SA, key: 'sa' },
  ];
  const inner: EdgeSpec[] = [
    { a: A.clone(), b: O.clone(), color: LOGO_COLORS.sage, len: L.LEN_AO, key: 'ao' },
    { a: C.clone(), b: O.clone(), color: LOGO_COLORS.copper, len: L.LEN_CO, key: 'co' },
    { a: S.clone(), b: O.clone(), color: LOGO_COLORS.blue, len: L.LEN_SO, key: 'so' },
  ];
  const allEdges = [...outer, ...inner];

  interface EdgeObj {
    spec: EdgeSpec;
    geometry: THREE.BufferGeometry;
    line: THREE.Line;
    glow: THREE.Line;
    segments: number;
  }

  function buildEdgeMesh(spec: EdgeSpec): EdgeObj {
    const segments = 96;
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      positions[i * 3] = THREE.MathUtils.lerp(spec.a.x, spec.b.x, t);
      positions[i * 3 + 1] = THREE.MathUtils.lerp(spec.a.y, spec.b.y, t);
      positions[i * 3 + 2] = THREE.MathUtils.lerp(spec.a.z, spec.b.z, t);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 2);

    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.72,
      })
    );
    const glow = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.085,
        blending: THREE.AdditiveBlending,
      })
    );
    return { spec, geometry, line, glow, segments };
  }

  const edgeObjs: EdgeObj[] = allEdges.map(buildEdgeMesh);
  const edgeGroup = new THREE.Group();
  for (const e of edgeObjs) {
    edgeGroup.add(e.glow);
    edgeGroup.add(e.line);
  }
  logo.add(edgeGroup);

  // Ghost / shadow of full scaffold (Plato’s wall) — blurred duplicate behind
  const shadowGroup = new THREE.Group();
  shadowGroup.position.set(0.02, -0.06, -0.08);
  shadowGroup.scale.setScalar(1.02);
  const fullVertCount = edgeObjs[0].segments + 1;
  for (const e of edgeObjs) {
    const g = e.geometry.clone();
    g.setDrawRange(0, fullVertCount);
    const sh = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({
        color: LOGO_COLORS.biolume,
        transparent: true,
        opacity: 0.038,
        blending: THREE.AdditiveBlending,
      })
    );
    shadowGroup.add(sh);
  }
  logo.add(shadowGroup);

  function setEdgeProgress(obj: EdgeObj, t: number): void {
    const n = Math.max(2, Math.floor((obj.segments + 1) * t));
    obj.geometry.setDrawRange(0, n);
  }

  // Nodes: same positions as SVG circles
  function makeNode(color: number, radius: number): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        metalness: 0.2,
        roughness: 0.35,
      })
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 2.1, 16, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    core.scale.setScalar(0.001);
    halo.scale.setScalar(0.001);
    g.add(core);
    g.add(halo);
    return g;
  }

  const nodeAnalysis = makeNode(LOGO_COLORS.sage, 0.0125);
  nodeAnalysis.position.copy(A);
  const nodeCritique = makeNode(LOGO_COLORS.copper, 0.0125);
  nodeCritique.position.copy(C);
  const nodeSynthesis = makeNode(LOGO_COLORS.blue, 0.0125);
  nodeSynthesis.position.copy(S);
  const nodeCenter = makeNode(LOGO_COLORS.amber, 0.0145);
  nodeCenter.position.copy(O);

  const nodeGroup = new THREE.Group();
  nodeGroup.add(nodeAnalysis, nodeCritique, nodeSynthesis, nodeCenter);
  logo.add(nodeGroup);

  // Particles (dust in the beam)
  const particleN = 720;
  const pGeom = new THREE.BufferGeometry();
  const pPos = new Float32Array(particleN * 3);
  const pBase = new Float32Array(particleN * 3);
  const pVel = new Float32Array(particleN);
  const pDriftX = new Float32Array(particleN);
  for (let i = 0; i < particleN; i++) {
    const ix = i * 3;
    const x = (Math.random() - 0.5) * 6;
    const y = Math.random() * 3.2 - 1.4;
    const z = (Math.random() - 0.5) * 2.4;
    pPos[ix] = x;
    pPos[ix + 1] = y;
    pPos[ix + 2] = z;
    pBase[ix] = x;
    pBase[ix + 1] = y;
    pBase[ix + 2] = z;
    pVel[i] = 0.02 + Math.random() * 0.018;
    pDriftX[i] = (Math.random() - 0.5) * 0.006;
  }
  pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xe8e4dc,
    size: 0.0105,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(pGeom, pMat);
  scene.add(stars);

  const pointer = new THREE.Vector2(50, 50);
  const deflectR = 0.38;

  let hovered = false;
  let targetSpin = THREE.MathUtils.degToRad(0.32);
  let spin = targetSpin;
  let scrollProgress = 0;
  let chapterProgress = 0;
  let caveIntensity = 0.58;

  const onMove = (ev: PointerEvent): void => {
    const r = container.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
    pointer.multiplyScalar(2.2);
  };
  const onEnter = (): void => {
    hovered = true;
  };
  const onLeave = (): void => {
    hovered = false;
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerenter', onEnter);
  container.addEventListener('pointerleave', onLeave);

  // Intro: draw outer triangle in order (matches logo narrative), then inner spokes, then nodes
  const intro = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
  const progresses = edgeObjs.map(() => ({ t: 0 }));

  edgeObjs.forEach((e, i) => setEdgeProgress(e, 0.002));

  const outerIdx = [0, 1, 2];
  let tCursor = 0.55;
  for (let k = 0; k < outerIdx.length; k++) {
    const i = outerIdx[k];
    intro.to(
      progresses[i],
      {
        t: 1,
        duration: 0.36,
        onUpdate: () => setEdgeProgress(edgeObjs[i], progresses[i].t),
      },
      tCursor
    );
    tCursor += 0.14;
  }
  tCursor += 0.08;
  for (let k = 3; k < 6; k++) {
    intro.to(
      progresses[k],
      {
        t: 1,
        duration: 0.28,
        onUpdate: () => setEdgeProgress(edgeObjs[k], progresses[k].t),
      },
      tCursor
    );
    tCursor += 0.1;
  }

  const bloomNodes = (node: THREE.Group, at: number): void => {
    const meshes = node.children as THREE.Mesh[];
    intro.to(
      meshes[0].scale,
      { x: 1, y: 1, z: 1, duration: 0.4, ease: 'power3.out' },
      at
    );
    intro.to(
      meshes[1].scale,
      { x: 1, y: 1, z: 1, duration: 0.45, ease: 'power3.out' },
      at
    );
  };
  bloomNodes(nodeAnalysis, 0.92);
  bloomNodes(nodeCritique, 1.08);
  bloomNodes(nodeSynthesis, 1.22);
  bloomNodes(nodeCenter, 1.38);

  intro.fromTo(logo.scale, { x: 0.9, y: 0.9, z: 0.9 }, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'power2.out' }, 0.5);

  const edgePulse = { k: 1 };
  const pulseTween = gsap.to(edgePulse, {
    k: 1.22,
    duration: 2.2,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });

  // Post-processing bloom (optional)
  let composer: { render: () => void; setSize: (w: number, h: number) => void; dispose: () => void } | null =
    null;
  try {
    const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
    const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
    const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');

    const comp = new EffectComposer(renderer);
    comp.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.1, 0.42, 0.95);
    comp.addPass(bloomPass);
    composer = comp;
  } catch {
    composer = null;
  }

  let raf = 0;
  let prev = performance.now();

  const tick = (now: number): void => {
    const dt = Math.min((now - prev) / 1000, 0.033);
    prev = now;

    targetSpin = hovered
      ? THREE.MathUtils.degToRad(1.45 + (scrollProgress * 0.5))
      : THREE.MathUtils.degToRad(0.3 + (scrollProgress * 0.15));
    spin = THREE.MathUtils.lerp(spin, targetSpin, 0.06);
    logo.rotation.y += spin * dt;
    logo.position.y = Math.sin(now * 0.00018) * 0.008 - (scrollProgress * 0.05);
    logo.position.x = THREE.MathUtils.lerp(logo.position.x, (chapterProgress - 0.5) * 0.08, 0.02);

    const attr = pGeom.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < particleN; i++) {
      const ix = i * 3;
      let x = attr.array[ix] as number;
      let y = attr.array[ix + 1] as number;
      const z = attr.array[ix + 2] as number;
      y += pVel[i] * dt;
      x += pDriftX[i] * dt;
      if (y > 1.6) y = -1.35;
      x = THREE.MathUtils.lerp(x, pBase[ix], 0.004);
      const dx = x - pointer.x * 1.1;
      const dy = y - pointer.y * 0.85;
      const d = Math.hypot(dx, dy);
      if (d < deflectR) {
        const f = (deflectR - d) / deflectR;
        const ang = Math.atan2(dy, dx);
        x += Math.cos(ang) * f * 0.018;
        y += Math.sin(ang) * f * 0.018;
      }
      attr.array[ix] = x;
      attr.array[ix + 1] = y;
      attr.array[ix + 2] = z;
    }
    attr.needsUpdate = true;

    const k = edgePulse.k * (0.78 + (caveIntensity * 0.35));
    for (const e of edgeObjs) {
      const mat = e.line.material as THREE.LineBasicMaterial;
      const gm = e.glow.material as THREE.LineBasicMaterial;
      mat.opacity = 0.58 * k;
      gm.opacity = 0.11 * k;
    }

    scene.fog.density = 0.061 + (scrollProgress * 0.04) - (caveIntensity * 0.008);
    key.intensity = 2.25 + (caveIntensity * 1.45) + (scrollProgress * 0.24);
    rim.intensity = 0.1 + (chapterProgress * 0.16);
    fill.intensity = 0.18 + ((1 - chapterProgress) * 0.14);
    beamMat.opacity = 0.03 + (caveIntensity * 0.042);
    mistMat.opacity = 0.08 + (scrollProgress * 0.06);

    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
  });
  ro.observe(container);

  function destroy(): void {
    cancelAnimationFrame(raf);
    ro.disconnect();
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerenter', onEnter);
    container.removeEventListener('pointerleave', onLeave);
    intro.kill();
    pulseTween.kill();

    pGeom.dispose();
    pMat.dispose();
    beamGeom.dispose();
    beamMat.dispose();
    mistGeom.dispose();
    mistMat.dispose();
    for (const e of edgeObjs) {
      e.geometry.dispose();
      (e.line.material as THREE.Material).dispose();
      (e.glow.material as THREE.Material).dispose();
    }
    shadowGroup.children.forEach((ch) => {
      const line = ch as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    composer?.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  }

  return {
    destroy,
    setHovered: (v: boolean) => {
      hovered = v;
    },
    setScrollProgress: (progress: number) => {
      scrollProgress = Math.max(0, Math.min(1, progress));
    },
    setChapter: (chapter: number) => {
      chapterProgress = Math.max(0, Math.min(1, chapter));
    },
    setIntensity: (intensity: number) => {
      caveIntensity = Math.max(0, Math.min(1, intensity));
    }
  };
}
