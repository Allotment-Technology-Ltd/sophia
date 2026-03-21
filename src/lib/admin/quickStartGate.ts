/**
 * First-visit gate: `/admin` redirects to `/admin/quick-start` until the user
 * continues with `?from_quick_start=1` or dismisses with `?skip_quick_start=1`.
 * Same params on operations/review dismiss without changing those routes' default URLs.
 */

export const ADMIN_QUICK_START_DISMISSED_KEY = 'sophia.admin.dismiss_quick_start';

export function consumeAdminQuickStartParams(): void {
	if (typeof window === 'undefined') return;
	const params = new URLSearchParams(window.location.search);
	if (params.get('from_quick_start') !== '1' && params.get('skip_quick_start') !== '1') return;
	try {
		localStorage.setItem(ADMIN_QUICK_START_DISMISSED_KEY, '1');
	} catch {
		/* private mode */
	}
	params.delete('from_quick_start');
	params.delete('skip_quick_start');
	const q = params.toString();
	const path = window.location.pathname;
	history.replaceState({}, '', q ? `${path}?${q}` : path);
}

export function isAdminQuickStartDismissed(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(ADMIN_QUICK_START_DISMISSED_KEY) === '1';
	} catch {
		return true;
	}
}

/** True when `/admin` ingestion home should send the user to quick-start. */
export function adminIngestionHomeShouldRedirectToQuickStart(search: string): boolean {
	if (typeof window === 'undefined') return false;
	const params = new URLSearchParams(search);
	if (params.get('setup') === '1') return false;
	return !isAdminQuickStartDismissed();
}
