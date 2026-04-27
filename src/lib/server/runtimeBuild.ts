/**
 * Build identity for `/api/health` so you can confirm production matches `main`.
 *
 * Railway provides `RAILWAY_GIT_COMMIT_SHA` for Git-based deploys. If you deploy via
 * `railway up` from GitHub Actions without that variable, set `COMMIT_SHA` in the
 * service or map `RAILWAY_GIT_COMMIT_SHA` in Railway (see `deployment-railway.md`).
 */
export function resolveRuntimeGitSha(): string | undefined {
  const v =
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.COMMIT_SHA?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function resolveRuntimeBuildLabel(): { git_sha: string | null; app_version: string } {
  return {
    git_sha: resolveRuntimeGitSha() ?? null,
    app_version: (process.env.npm_package_version ?? '0.0.0').trim()
  };
}
