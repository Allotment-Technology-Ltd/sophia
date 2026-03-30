import * as THREE from 'three';

export interface StoaSpriteOptions {
  size?: number;
  textureUrl?: string;
  color?: THREE.ColorRepresentation;
}

function createPlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#203045';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f4e8ca';
    ctx.beginPath();
    ctx.arc(128, 112, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8b89d';
    ctx.fillRect(88, 170, 80, 146);
    ctx.fillStyle = '#88adc8';
    ctx.fillRect(42, 324, 172, 20);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function createStoaSprite(options: StoaSpriteOptions = {}): Promise<THREE.Sprite> {
  const { size = 2.8, textureUrl, color = '#ffffff' } = options;

  let texture: THREE.Texture;
  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    texture = await loader.loadAsync(textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
  } else {
    texture = createPlaceholderTexture();
  }

  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(size * 0.75, size, 1);
  return sprite;
}
