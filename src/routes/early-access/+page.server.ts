import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const neonAuthConfigured = Boolean(
    process.env.NEON_AUTH_BASE_URL?.trim() || process.env.VITE_NEON_AUTH_URL?.trim()
  );
  return {
    googleSignInAvailable: neonAuthConfigured
  };
};
