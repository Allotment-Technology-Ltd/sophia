<script lang="ts">
  // @ts-nocheck
  import { onDestroy, onMount } from 'svelte';
  import * as THREE from 'three';
  import { gsap } from 'gsap';

  let canvasEl: HTMLCanvasElement | null = null;
  let rootEl: HTMLDivElement | null = null;
  let hazeNearEl: HTMLDivElement | null = null;
  let hazeFarEl: HTMLDivElement | null = null;

  let isMobile = false;
  let hovered = false;

  const mobileBreakpoint = 768;
  const particleCount = 600;
  const particleDeflectRadius = 0.34;

  let cleanup: (() => void) | null = null;

  interface EdgeState {
    geometry: THREE.BufferGeometry;
    line: THREE.Line;
    glow: THREE.Line;
    segments: number;
    start: THREE.Vector3;
    end: THREE.Vector3;
  }

  function updateMobileState(): void {
    if (typeof window === 'undefined') return;
    isMobile = window.innerWidth < mobileBreakpoint;
  }

  function buildEdge(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: string,
    opacity = 0.95
  ): EdgeState {
    const segments = 84;
    const positions = new Float32Array((segments + 1) * 3);

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      positions[i * 3] = THREE.MathUtils.lerp(start.x, end.x, t);
      positions[i * 3 + 1] = THREE.MathUtils.lerp(start.y, end.y, t);
      positions[i * 3 + 2] = THREE.MathUtils.lerp(start.z, end.z, t);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 2);

    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity
      })
    );

    const glow = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: opacity * 0.2,
        blending: THREE.AdditiveBlending
      })
    );
    glow.scale.setScalar(1.002);

    return { geometry, line, glow, segments, start, end };
  }

  function createNode(color: string): THREE.Group {
    const node = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 20, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })
    );
    core.scale.setScalar(0.001);
    node.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
      })
    );
    halo.scale.setScalar(0.001);
    node.add(halo);

    return node;
  }

  function animateEdgeDraw(edge: EdgeState, progress: number): void {
    const drawCount = Math.max(2, Math.floor((edge.segments + 1) * progress));
    edge.geometry.setDrawRange(0, drawCount);
  }

  function setupCanvas(): () => void {
    if (!canvasEl || !rootEl) return () => {};

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(rootEl.clientWidth, rootEl.clientHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, rootEl.clientWidth / rootEl.clientHeight, 0.1, 20);
    camera.position.set(0, 0, 3.2);

    const stage = new THREE.Group();
    stage.rotation.x = THREE.MathUtils.degToRad(13.5);
    stage.rotation.y = THREE.MathUtils.degToRad(5);
    scene.add(stage);

    const shadowGroup = new THREE.Group();
    shadowGroup.position.set(0.04, -0.08, -0.12);
    stage.add(shadowGroup);

    const triangleGroup = new THREE.Group();
    stage.add(triangleGroup);

    const top = new THREE.Vector3(0, 0.72, 0);
    const left = new THREE.Vector3(-0.88, -0.65, 0);
    const right = new THREE.Vector3(0.88, -0.65, 0);

    const shadowMat = new THREE.LineBasicMaterial({
      color: '#c8d8e8',
      transparent: true,
      opacity: 0.04
    });
    shadowGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([top, left]), shadowMat),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([left, right]), shadowMat),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([right, top]), shadowMat)
    );

    const edgeA = buildEdge(top, left, '#8a9e8c');
    const edgeB = buildEdge(left, right, '#6e7ea8');
    const edgeC = buildEdge(right, top, '#c4935a');
    const edges = [edgeA, edgeB, edgeC];
    for (const edge of edges) {
      triangleGroup.add(edge.glow);
      triangleGroup.add(edge.line);
    }

    const nodeTop = createNode('#8a9e8c');
    nodeTop.position.copy(top);
    const nodeLeft = createNode('#6e7ea8');
    nodeLeft.position.copy(left);
    const nodeRight = createNode('#c4935a');
    nodeRight.position.copy(right);
    const nodes = [nodeTop, nodeLeft, nodeRight];
    for (const node of nodes) triangleGroup.add(node);

    const starGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const base = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);
    const xDrift = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i += 1) {
      const ix = i * 3;
      const x = (Math.random() - 0.5) * 5.6;
      const y = (Math.random() * 3.4) - 1.95;
      const z = (Math.random() - 0.5) * 2.8;
      positions[ix] = x;
      positions[ix + 1] = y;
      positions[ix + 2] = z;
      base[ix] = x;
      base[ix + 1] = y;
      base[ix + 2] = z;
      velocities[i] = 0.018 + (Math.random() * 0.012);
      xDrift[i] = (Math.random() - 0.5) * 0.004;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: '#f2f3ee',
      size: 0.014,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    const pointer = new THREE.Vector2(100, 100);
    const handleMove = (event: PointerEvent): void => {
      if (!rootEl) return;
      const rect = rootEl.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      pointer.x = nx * 2.3;
      pointer.y = ny * 1.45;
    };
    const handleEnter = (): void => {
      hovered = true;
    };
    const handleLeave = (): void => {
      hovered = false;
    };
    rootEl.addEventListener('pointermove', handleMove);
    rootEl.addEventListener('pointerenter', handleEnter);
    rootEl.addEventListener('pointerleave', handleLeave);

    let targetRotationSpeed = THREE.MathUtils.degToRad(0.3);
    let currentRotationSpeed = targetRotationSpeed;
    let glowLevel = 1;
    const edgePulse = { level: 1 };
    const edgeGlowTween = gsap.to(edgePulse, {
      level: 1.2,
      duration: 2,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      onUpdate: () => {
        glowLevel = edgePulse.level;
      }
    });

    const choreography = gsap.timeline({ defaults: { ease: 'power2.out' } });

    const edgeProgress = [{ p: 0 }, { p: 0 }, { p: 0 }];
    for (let i = 0; i < edges.length; i += 1) {
      animateEdgeDraw(edges[i], 0.001);
    }

    choreography.fromTo(triangleGroup.scale, { x: 0.94, y: 0.94, z: 0.94 }, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.9,
      ease: 'power2.out'
    }, 0.62);

    choreography.to(edgeProgress[0], {
      p: 1,
      duration: 0.28,
      onUpdate: () => animateEdgeDraw(edgeA, edgeProgress[0].p)
    }, 0.8);
    choreography.to(nodeTop.children.map((child) => (child as THREE.Mesh).material), {
      opacity: (index: number) => (index === 0 ? 1 : 0.42),
      duration: 0.26
    }, 1.02);
    choreography.to(nodeTop.scale, { x: 1, y: 1, z: 1, duration: 0.26 }, 1.02);
    choreography.to(nodeTop.children.map((child) => child.scale), { x: 1, y: 1, z: 1, duration: 0.26 }, 1.02);

    choreography.to(edgeProgress[1], {
      p: 1,
      duration: 0.28,
      onUpdate: () => animateEdgeDraw(edgeB, edgeProgress[1].p)
    }, 1.05);
    choreography.to(nodeLeft.children.map((child) => (child as THREE.Mesh).material), {
      opacity: (index: number) => (index === 0 ? 1 : 0.42),
      duration: 0.26
    }, 1.25);
    choreography.to(nodeLeft.scale, { x: 1, y: 1, z: 1, duration: 0.26 }, 1.25);
    choreography.to(nodeLeft.children.map((child) => child.scale), { x: 1, y: 1, z: 1, duration: 0.26 }, 1.25);

    choreography.to(edgeProgress[2], {
      p: 1,
      duration: 0.3,
      onUpdate: () => animateEdgeDraw(edgeC, edgeProgress[2].p)
    }, 1.3);
    choreography.to(nodeRight.children.map((child) => (child as THREE.Mesh).material), {
      opacity: (index: number) => (index === 0 ? 1 : 0.42),
      duration: 0.26
    }, 1.5);
    choreography.to(nodeRight.scale, { x: 1, y: 1, z: 1, duration: 0.26 }, 1.5);
    choreography.to(nodeRight.children.map((child) => child.scale), { x: 1, y: 1, z: 1, duration: 0.26 }, 1.5);

    let raf = 0;
    let previousTime = performance.now();

    const loop = (time: number): void => {
      const delta = Math.min((time - previousTime) / 1000, 0.032);
      previousTime = time;

      targetRotationSpeed = hovered
        ? THREE.MathUtils.degToRad(1.5)
        : THREE.MathUtils.degToRad(0.3);
      currentRotationSpeed = THREE.MathUtils.lerp(currentRotationSpeed, targetRotationSpeed, 0.045);
      stage.rotation.y += currentRotationSpeed * delta;
      stage.position.y = Math.sin(time * 0.00028) * 0.016;

      const starPositions = starGeometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i += 1) {
        const ix = i * 3;
        let x = starPositions.array[ix] as number;
        let y = starPositions.array[ix + 1] as number;
        const z = starPositions.array[ix + 2] as number;

        y += velocities[i] * delta;
        x += xDrift[i] * delta;
        if (y > 1.8) {
          y = -1.95;
        }

        x = THREE.MathUtils.lerp(x, base[ix], 0.005);
        y = THREE.MathUtils.lerp(y, y + (base[ix + 1] - y) * 0.004, 0.96);

        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (distance < particleDeflectRadius) {
          const force = (particleDeflectRadius - distance) / particleDeflectRadius;
          const angle = Math.atan2(dy, dx);
          x += Math.cos(angle) * force * 0.016;
          y += Math.sin(angle) * force * 0.016;
        }

        starPositions.array[ix] = x;
        starPositions.array[ix + 1] = y;
        starPositions.array[ix + 2] = z;
      }
      starPositions.needsUpdate = true;

      for (const edge of edges) {
        const edgeLineMaterial = edge.line.material as THREE.LineBasicMaterial;
        const edgeGlowMaterial = edge.glow.material as THREE.LineBasicMaterial;
        edgeLineMaterial.opacity = 0.84 * glowLevel;
        edgeGlowMaterial.opacity = 0.2 * glowLevel;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const handleResize = (): void => {
      if (!rootEl) return;
      const width = rootEl.clientWidth;
      const height = rootEl.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      rootEl?.removeEventListener('pointermove', handleMove);
      rootEl?.removeEventListener('pointerenter', handleEnter);
      rootEl?.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('resize', handleResize);
      edgeGlowTween.kill();
      choreography.kill();

      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();

      for (const edge of edges) {
        edge.geometry.dispose();
        (edge.line.material as THREE.Material).dispose();
        (edge.glow.material as THREE.Material).dispose();
      }
    };
  }

  onMount(() => {
    updateMobileState();
    const onResize = (): void => {
      const previous = isMobile;
      updateMobileState();
      if (previous !== isMobile) {
        cleanup?.();
        cleanup = isMobile ? null : setupCanvas();
      }
    };
    window.addEventListener('resize', onResize);

    const hazeTimeline = gsap.timeline({ repeat: -1, yoyo: true });
    if (hazeNearEl && hazeFarEl) {
      hazeTimeline
        .to(hazeNearEl, { opacity: 0.08, duration: 10, ease: 'sine.inOut' }, 0)
        .to(hazeFarEl, { opacity: 0.03, duration: 12, ease: 'sine.inOut' }, 0);
    }

    if (!isMobile) {
      cleanup = setupCanvas();
    }

    return () => {
      window.removeEventListener('resize', onResize);
      hazeTimeline.kill();
      cleanup?.();
    };
  });

  onDestroy(() => {
    cleanup?.();
  });
</script>

<div class="cave-canvas" bind:this={rootEl} aria-hidden="true">
  <div class="volumetric-haze volumetric-haze-near" bind:this={hazeNearEl}></div>
  <div class="volumetric-haze volumetric-haze-far" bind:this={hazeFarEl}></div>

  {#if isMobile}
    <div class="mobile-triangle" aria-hidden="true">
      <svg viewBox="0 0 320 300" fill="none">
        <path class="edge edge-one" d="M160 38 L56 238" />
        <path class="edge edge-two" d="M56 238 L264 238" />
        <path class="edge edge-three" d="M264 238 L160 38" />
        <circle class="node node-one" cx="160" cy="38" r="8"></circle>
        <circle class="node node-two" cx="56" cy="238" r="8"></circle>
        <circle class="node node-three" cx="264" cy="238" r="8"></circle>
      </svg>
    </div>
  {:else}
    <canvas bind:this={canvasEl} aria-hidden="true"></canvas>
  {/if}
</div>

<style>
  .cave-canvas {
    position: relative;
    width: min(45vw, 620px);
    height: min(72vh, 680px);
    min-height: 420px;
    margin-left: auto;
    filter:
      drop-shadow(0 18px 46px rgba(0, 0, 0, 0.48))
      drop-shadow(0 0 24px rgba(200, 216, 232, 0.08));
  }

  canvas,
  .mobile-triangle {
    width: 100%;
    height: 100%;
    display: block;
  }

  .volumetric-haze {
    pointer-events: none;
    position: absolute;
    inset: -16% -24%;
    opacity: 0.035;
    mix-blend-mode: screen;
  }

  .volumetric-haze-near {
    background:
      radial-gradient(130% 95% at 48% -8%, rgba(200, 216, 232, 0.12), transparent 66%),
      radial-gradient(115% 92% at 62% 2%, rgba(138, 158, 140, 0.1), transparent 70%);
  }

  .volumetric-haze-far {
    inset: -8% -20%;
    background:
      radial-gradient(120% 90% at 46% -12%, rgba(200, 216, 232, 0.1), transparent 74%);
    filter: blur(14px);
    opacity: 0.02;
  }

  .mobile-triangle {
    display: grid;
    place-items: center;
  }

  .mobile-triangle svg {
    width: min(86vw, 340px);
    height: auto;
    overflow: visible;
  }

  .mobile-triangle .edge {
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-dasharray: 260;
    stroke-dashoffset: 260;
    animation: edgeDraw 1.3s ease forwards;
    filter: drop-shadow(0 0 8px rgba(200, 216, 232, 0.2));
  }

  .mobile-triangle .edge-one {
    stroke: #8a9e8c;
    animation-delay: 0.72s;
  }

  .mobile-triangle .edge-two {
    stroke: #6e7ea8;
    animation-delay: 0.94s;
  }

  .mobile-triangle .edge-three {
    stroke: #c4935a;
    animation-delay: 1.15s;
  }

  .mobile-triangle .node {
    transform-origin: center;
    transform-box: fill-box;
    opacity: 0;
    animation: nodeBloom 0.5s cubic-bezier(0.18, 1, 0.32, 1) forwards;
  }

  .mobile-triangle .node-one {
    fill: #8a9e8c;
    animation-delay: 1s;
  }

  .mobile-triangle .node-two {
    fill: #6e7ea8;
    animation-delay: 1.26s;
  }

  .mobile-triangle .node-three {
    fill: #c4935a;
    animation-delay: 1.52s;
  }

  @keyframes edgeDraw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes nodeBloom {
    from {
      opacity: 0;
      transform: scale(0.2);
      filter: drop-shadow(0 0 0 rgba(200, 216, 232, 0));
    }
    to {
      opacity: 1;
      transform: scale(1);
      filter: drop-shadow(0 0 8px rgba(200, 216, 232, 0.3));
    }
  }

  @media (max-width: 1080px) {
    .cave-canvas {
      width: min(52vw, 560px);
    }
  }

  @media (max-width: 767px) {
    .cave-canvas {
      width: 100%;
      min-height: 280px;
      height: 44vh;
      max-height: 440px;
    }
  }
</style>
