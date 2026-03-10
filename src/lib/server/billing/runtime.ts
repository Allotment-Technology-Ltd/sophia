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

function isNonProductionDeployEnv(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (vercelEnv === 'preview' || vercelEnv === 'development') return true;

  const cfEnv = (process.env.CF_PAGES ?? '').trim().toLowerCase();
  if (cfEnv === '1' || cfEnv === 'true') {
    const cfBranch = (process.env.CF_PAGES_BRANCH ?? '').trim().toLowerCase();
    return !!cfBranch && cfBranch !== 'main' && cfBranch !== 'master' && cfBranch !== 'production';
  }

  return false;
}

function looksLikeLocalUrl(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  } catch {
    return true;
  }
}

interface ResolveRuntimeOptions {
  requestUrl?: string;
}

export function resolvePaddleRuntime(options?: ResolveRuntimeOptions): PaddleRuntime {
  const explicit = (process.env.PADDLE_RUNTIME ?? '').trim().toLowerCase();
  if (explicit === 'sandbox') return 'sandbox';
  if (explicit === 'production') return 'production';

  // Always keep local/dev traffic on sandbox unless explicitly overridden.
  const requestUrl = options?.requestUrl;
  if (looksLikeLocalUrl(requestUrl)) {
    if (!isProductionNodeRuntime() && !isProductionDeployEnv()) return 'sandbox';
  }

  if (isNonProductionDeployEnv()) return 'sandbox';
  if (isProductionNodeRuntime()) return 'production';
  if (isProductionDeployEnv()) return 'production';
  return 'sandbox';
}
