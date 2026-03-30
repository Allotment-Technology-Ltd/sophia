export const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window;

export async function getTauriVersion(): Promise<string | null> {
  if (!IS_TAURI) {
    return null;
  }

  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}
