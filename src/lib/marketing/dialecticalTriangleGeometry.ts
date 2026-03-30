/**
 * Canonical dialectical triangle geometry — matches `DialecticalTriangle.svelte` / wordmark SVG.
 * SVG viewBox "-68 -76 136 140"; Y increases downward in SVG.
 *
 * Analysis (sage) top, Critique (copper) bottom-right, Synthesis (blue) bottom-left, centre O (amber).
 */
export const DIALECTICAL_TRIANGLE_SVG = {
  analysis: { x: 0, y: -45 },
  critique: { x: 39, y: 22 },
  synthesis: { x: -39, y: 22 },
  center: { x: 0, y: 0 },
} as const;

/** Edge lengths in SVG units (same formulas as DialecticalTriangle.svelte). */
export const DIALECTICAL_EDGE_LEN = {
  LEN_AC: Math.sqrt(39 ** 2 + 67 ** 2),
  LEN_CS: 78,
  LEN_SA: Math.sqrt(39 ** 2 + 67 ** 2),
  LEN_AO: 45,
  LEN_CO: Math.sqrt(39 ** 2 + 22 ** 2),
  LEN_SO: Math.sqrt(39 ** 2 + 22 ** 2),
} as const;

/** Map SVG coords to Three.js with Y-up (SVG Y-down → negate for world Y). Z = 0 in logo plane. */
export function svgPointToThree(
  svgX: number,
  svgY: number,
  scale: number
): { x: number; y: number; z: number } {
  return { x: svgX * scale, y: -svgY * scale, z: 0 };
}

export const LOGO_COLORS = {
  sage: 0x8a9e8c,
  copper: 0xc4935a,
  blue: 0x6e7ea8,
  amber: 0xc4a882,
  biolume: 0xc8d8e8,
  caveDeep: 0x030302,
  mist: 0x1a1c14,
} as const;
