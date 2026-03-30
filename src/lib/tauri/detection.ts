export const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window;

export async function getTauriVersion(): Promise<string | null> {
  if (!IS_TAURI) return null;
  return null;
}
