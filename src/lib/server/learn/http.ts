import { json } from '@sveltejs/kit';

export function isLearnModuleEnabled(): boolean {
  return (process.env.ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true';
}

export function learnModuleDisabledResponse() {
  return json({ error: 'learn_module_disabled' }, { status: 404 });
}

export function requireUid(locals: App.Locals): string | null {
  return locals.user?.uid ?? null;
}

export function unauthorizedResponse() {
  return json({ error: 'Authentication required' }, { status: 401 });
}
