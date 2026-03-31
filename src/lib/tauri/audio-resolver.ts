import { IS_TAURI } from '$lib/tauri/detection';

const AMBIENT_WEB_PREFIX = '/audio/ambient/';

function normalizeAmbientRelativePath(relativePath: string): string {
  if (!relativePath.startsWith('/')) {
    return relativePath;
  }

  if (relativePath.startsWith(AMBIENT_WEB_PREFIX)) {
    return relativePath.slice(AMBIENT_WEB_PREFIX.length);
  }

  return relativePath.slice(1);
}

export async function resolveAudioSrc(relativePath: string): Promise<string> {
  const normalizedPath = normalizeAmbientRelativePath(relativePath);
  // Keep a stable URL path for both web and Tauri builds.
  // Tauri runtime can still serve bundled/public assets from this route.
  if (IS_TAURI) {
    return `${AMBIENT_WEB_PREFIX}${normalizedPath}`;
  }
  return `${AMBIENT_WEB_PREFIX}${normalizedPath}`;
}
