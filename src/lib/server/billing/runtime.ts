export type PaddleRuntime = 'sandbox' | 'production';

function isProductionNodeRuntime(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function isProductionDeployEnv(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (vercelEnv === 'production') return true;

  const cfEnv = (process.env.CF_PAGES ?? '').trim().toLowerCase();
  if (cfEnv === '1' || cfEnv === 'true') {
    const cfBranch = (process.env.CF_PAGES_BRANCH ?? '').trim().toLowerCase();
    if (!cfBranch || cfBranch === 'main' || cfBranch === 'master' || cfBranch === 'production') {
      return true;
    }
  }

  return false;
}

function looksLikeProductionUrl(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolvePaddleRuntime(): PaddleRuntime {
  const explicit = (process.env.PADDLE_RUNTIME ?? '').trim().toLowerCase();
  if (explicit === 'sandbox') return 'sandbox';
  if (explicit === 'production') return 'production';

  if (isProductionNodeRuntime()) return 'production';
  if (isProductionDeployEnv()) return 'production';
  if (looksLikeProductionUrl(process.env.PUBLIC_APP_URL)) return 'production';
  if (looksLikeProductionUrl(process.env.PUBLIC_BASE_URL)) return 'production';
  return 'sandbox';
}

