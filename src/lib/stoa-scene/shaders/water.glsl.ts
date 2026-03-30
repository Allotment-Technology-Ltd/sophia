export const waterVertexShader = `
uniform float uTime;
uniform float uWaveHeight;

varying vec2 vUv;
varying float vWave;

void main() {
  vUv = uv;

  vec3 transformed = position;
  float waveA = sin((position.x * 0.55) + (uTime * 0.38));
  float waveB = cos((position.y * 0.72) + (uTime * 0.27));
  float waveC = sin(((position.x + position.y) * 0.35) - (uTime * 0.19));
  float wave = (waveA + waveB + waveC) / 3.0;

  transformed.z += wave * uWaveHeight;
  vWave = wave;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const waterFragmentShader = `
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;

varying vec2 vUv;
varying float vWave;

void main() {
  float drift = sin((vUv.x * 6.0) + (uTime * 0.2)) * 0.5 + 0.5;
  float waveMix = smoothstep(-0.45, 0.55, vWave + ((drift - 0.5) * 0.25));

  vec3 baseColor = mix(uDeepColor, uShallowColor, waveMix);

  float foamBand = smoothstep(0.5, 0.85, vWave);
  float foamNoise = smoothstep(0.15, 1.0, sin((vUv.x * 18.0) + (uTime * 0.9)) * 0.5 + 0.5);
  float foam = foamBand * foamNoise * 0.45;
  vec3 foamColor = vec3(0.9, 0.97, 1.0);

  float horizonFade = smoothstep(1.0, 0.2, vUv.y);
  vec3 color = mix(baseColor, foamColor, foam);
  color = mix(color * 0.55, color, horizonFade);

  gl_FragColor = vec4(color, 0.84);
}
`;
