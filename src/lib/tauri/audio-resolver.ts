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

  if (!IS_TAURI) {
    return `${AMBIENT_WEB_PREFIX}${normalizedPath}`;
  }

  try {
    const [{ appDataDir, resolve }, { convertFileSrc }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/api/core')
    ]);
    const appDataPath = await appDataDir();
    const fullPath = await resolve(appDataPath, 'audio', 'ambient', normalizedPath);
    return convertFileSrc(fullPath);
  } catch {
    return `${AMBIENT_WEB_PREFIX}${normalizedPath}`;
  }
}
