import * as THREE from 'three';

export interface ColumnLayoutOptions {
  count?: number;
  spacing?: number;
  height?: number;
  radius?: number;
  color?: THREE.ColorRepresentation;
}

export function createColumns(options: ColumnLayoutOptions = {}): THREE.InstancedMesh {
  const {
    count = 10,
    spacing = 3.5,
    height = 4,
    radius = 0.24,
    color = '#e7dcc7'
  } = options;

  const geometry = new THREE.CylinderGeometry(radius, radius * 1.1, height, 24, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.08
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const rows = 2;
  const perRow = Math.ceil(count / rows);
  const startX = -((perRow - 1) * spacing) / 2;
  const zPositions = [-2.8, 2.8];

  let index = 0;
  for (let row = 0; row < rows && index < count; row += 1) {
    for (let col = 0; col < perRow && index < count; col += 1) {
      matrix.makeTranslation(startX + col * spacing, height * 0.5, zPositions[row]);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
