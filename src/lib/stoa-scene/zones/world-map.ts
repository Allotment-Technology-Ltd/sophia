import * as THREE from 'three';
import type { WorldMapEdge, WorldMapNode } from '$lib/types/stoa';

type DisposeFn = () => void;
type UpdateFn = (delta: number, hour?: number, elapsed?: number) => void;
type HoverFn = (pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera) => void;
type PickFn = (
  pointerNdc: THREE.Vector2,
  camera: THREE.PerspectiveCamera
) => {
  node: WorldMapNode;
  focus: { position: THREE.Vector3; target: THREE.Vector3 };
} | null;
type SelectNodeFn = (nodeId: string | null) => void;

interface WorldMapBuildInput {
  nodes: WorldMapNode[];
  edges: WorldMapEdge[];
}

interface WorldMapNodeRender {
  node: WorldMapNode;
  sphere: THREE.Mesh;
  glow: THREE.PointLight;
  label: THREE.Sprite;
  baseScale: number;
}

const TYPE_CONFIG: Record<
  WorldMapNode['type'],
  { radius: number; unlockedColor: string; lockedColor: string; activeColor: string }
> = {
  thinker: {
    radius: 0.5,
    unlockedColor: '#b87333',
    lockedColor: '#555555',
    activeColor: '#d58a45'
  },
  framework: {
    radius: 0.3,
    unlockedColor: '#8da78b',
    lockedColor: '#506050',
    activeColor: '#9dbf99'
  },
  concept: {
    radius: 0.15,
    unlockedColor: '#5f8ecf',
    lockedColor: '#3a4b64',
    activeColor: '#7aa8e8'
  }
};

function createLabelSprite(label: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(18, 19, 24, 0.82)';
    ctx.strokeStyle = 'rgba(221, 206, 180, 0.65)';
    ctx.lineWidth = 3;
    ctx.fillRect(4, 10, 504, 108);
    ctx.strokeRect(4, 10, 504, 108);
    ctx.fillStyle = 'rgba(245, 232, 210, 0.96)';
    ctx.font = '600 40px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 64);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.6, 1);
  sprite.visible = false;
  return sprite;
}

function toNodePosition(node: WorldMapNode): THREE.Vector3 {
  return new THREE.Vector3(node.position.x, node.position.y, node.position.z);
}

function resolveNodeColor(node: WorldMapNode): string {
  const config = TYPE_CONFIG[node.type];
  if (!node.isUnlocked) return config.lockedColor;
  if (node.isActive) return config.activeColor;
  return config.unlockedColor;
}

export async function buildWorldMap(input: WorldMapBuildInput): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'stoa-zone-world-map';

  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const rendered = new Map<string, WorldMapNodeRender>();
  const pooledTextures = new Set<THREE.Texture>();
  const pooledMaterials = new Set<THREE.Material>();
  const pooledGeometries = new Set<THREE.BufferGeometry>();

  const edgeGroup = new THREE.Group();
  edgeGroup.name = 'stoa-world-map-edges';
  group.add(edgeGroup);

  for (const edge of edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;

    const points = [toNodePosition(fromNode), toNodePosition(toNode)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    pooledGeometries.add(geometry);
    const opacity = Math.max(0.12, Math.min(0.75, edge.strength));
    const material = new THREE.LineBasicMaterial({
      color: '#b8c2d4',
      transparent: true,
      opacity
    });
    pooledMaterials.add(material);
    const line = new THREE.Line(geometry, material);
    line.userData.edgeType = edge.type;
    edgeGroup.add(line);
  }

  const nodeGroup = new THREE.Group();
  nodeGroup.name = 'stoa-world-map-nodes';
  group.add(nodeGroup);

  for (const node of nodes) {
    const config = TYPE_CONFIG[node.type];
    const geometry = new THREE.SphereGeometry(config.radius, 26, 26);
    pooledGeometries.add(geometry);
    const material = new THREE.MeshStandardMaterial({
      color: resolveNodeColor(node),
      roughness: node.isUnlocked ? 0.24 : 0.78,
      metalness: node.isUnlocked ? 0.38 : 0.05,
      emissive: node.isUnlocked ? new THREE.Color(resolveNodeColor(node)) : new THREE.Color('#1b1b1b'),
      emissiveIntensity: node.isUnlocked ? (node.isActive ? 0.55 : 0.3) : 0.1,
      transparent: !node.isUnlocked,
      opacity: node.isUnlocked ? 1 : 0.56
    });
    pooledMaterials.add(material);
    const sphere = new THREE.Mesh(geometry, material);
    const nodePosition = toNodePosition(node);
    sphere.position.copy(nodePosition);
    sphere.userData.worldMapNodeId = node.id;
    sphere.userData.interactive = true;
    sphere.castShadow = false;
    sphere.receiveShadow = false;
    nodeGroup.add(sphere);

    const glow = new THREE.PointLight(
      node.isUnlocked ? resolveNodeColor(node) : '#7d7d7d',
      node.isUnlocked ? (node.isActive ? 0.95 : 0.62) : 0.18,
      node.isUnlocked ? 4.8 : 2.4,
      2
    );
    glow.position.copy(nodePosition);
    group.add(glow);

    const label = createLabelSprite(node.label);
    const labelMaterial = label.material as THREE.SpriteMaterial;
    if (labelMaterial.map) pooledTextures.add(labelMaterial.map);
    pooledMaterials.add(labelMaterial);
    label.position.copy(nodePosition).add(new THREE.Vector3(0, config.radius + 0.55, 0));
    group.add(label);

    rendered.set(node.id, {
      node,
      sphere,
      glow,
      label,
      baseScale: 1
    });
  }

  const studentNode =
    nodes.find((node) => node.isCurrentPosition) ??
    nodes.find((node) => node.isActive) ??
    nodes.find((node) => node.isUnlocked) ??
    nodes[0];
  if (studentNode) {
    const markerGeometry = new THREE.SphereGeometry(0.09, 18, 18);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: '#fff8dc',
      emissive: '#fff1cc',
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.28
    });
    pooledGeometries.add(markerGeometry);
    pooledMaterials.add(markerMaterial);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(toNodePosition(studentNode).add(new THREE.Vector3(0, 0.62, 0)));
    marker.userData.studentMarker = true;
    group.add(marker);
  }

  const ambient = new THREE.AmbientLight('#9eb3ce', 0.28);
  group.add(ambient);

  let hoveredNodeId: string | null = null;
  let selectedNodeId: string | null = null;
  let pulseTime = 0;
  const raycaster = new THREE.Raycaster();

  const clearHover = (): void => {
    if (!hoveredNodeId) return;
    const render = rendered.get(hoveredNodeId);
    if (render) {
      render.label.visible = false;
      render.sphere.scale.setScalar(render.baseScale);
    }
    hoveredNodeId = null;
  };

  const setHovered = (nodeId: string | null): void => {
    if (nodeId === hoveredNodeId) return;
    clearHover();
    hoveredNodeId = nodeId;
    if (!hoveredNodeId) return;
    const render = rendered.get(hoveredNodeId);
    if (!render) return;
    render.label.visible = true;
  };

  const setSelected: SelectNodeFn = (nodeId) => {
    selectedNodeId = nodeId && rendered.has(nodeId) ? nodeId : null;
  };

  const hover: HoverFn = (pointerNdc, camera) => {
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(nodeGroup.children, false);
    const nodeId = (hits[0]?.object.userData?.worldMapNodeId as string | undefined) ?? null;
    setHovered(nodeId);
  };

  const pick: PickFn = (pointerNdc, camera) => {
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(nodeGroup.children, false);
    const mesh = hits[0]?.object as THREE.Mesh | undefined;
    const nodeId = (mesh?.userData?.worldMapNodeId as string | undefined) ?? null;
    if (!nodeId) return null;
    const render = rendered.get(nodeId);
    if (!render) return null;
    selectedNodeId = nodeId;
    setHovered(nodeId);

    const nodePos = render.sphere.position.clone();
    const focus = {
      target: nodePos.clone(),
      position: nodePos.clone().add(new THREE.Vector3(0, 1.3, 3.2))
    };
    return {
      node: render.node,
      focus
    };
  };

  const update: UpdateFn = (delta) => {
    pulseTime += Math.max(0, delta);
    if (hoveredNodeId) {
      const render = rendered.get(hoveredNodeId);
      if (render) {
        const pulse = 1 + Math.sin(pulseTime * 8.2) * 0.08;
        render.sphere.scale.setScalar(render.baseScale * pulse);
      }
    }

    if (selectedNodeId && selectedNodeId !== hoveredNodeId) {
      const selected = rendered.get(selectedNodeId);
      if (selected) {
        const breathe = 1 + Math.sin(pulseTime * 2.7) * 0.04;
        selected.sphere.scale.setScalar(selected.baseScale * breathe);
      }
    }
  };

  const dispose: DisposeFn = () => {
    for (const texture of pooledTextures) {
      texture.dispose();
    }
    for (const material of pooledMaterials) {
      material.dispose();
    }
    for (const geometry of pooledGeometries) {
      geometry.dispose();
    }
  };

  group.userData.update = update;
  group.userData.hover = hover;
  group.userData.pick = pick;
  group.userData.setSelection = setSelected;
  group.userData.cameraOverride = true;
  group.userData.dispose = dispose;

  return group;
}
