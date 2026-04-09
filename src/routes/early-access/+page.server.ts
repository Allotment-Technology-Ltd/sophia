import { env as publicEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const url =
    publicEnv.PUBLIC_NEON_AUTH_URL?.trim() ||
    process.env.NEON_AUTH_BASE_URL?.trim() ||
    process.env.VITE_NEON_AUTH_URL?.trim() ||
    '';
  return {
    neonAuthUrlPresent: Boolean(url)
  };
};
