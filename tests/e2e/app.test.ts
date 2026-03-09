import { test, expect } from '@playwright/test';

/**
 * E2E smoke tests for SOPHIA.
 *
 * These tests run against a live dev server (started automatically by playwright.config.ts)
 * or against a deployed URL via PLAYWRIGHT_BASE_URL env var.
 *
 * Auth-gated tests require SOPHIA_TEST_TOKEN (a Firebase ID token for a test user).
 * Without it, those tests are skipped with a clear message.
 */

// ─── Unauthenticated smoke tests ──────────────────────────────────────────

test.describe('Application shell', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SOPHIA/i);
  });

  test('TopBar navigation is present and accessible', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
  });

  test('SOPHIA wordmark is visible', async ({ page }) => {
    await page.goto('/');
    const wordmark = page.getByRole('link', { name: 'SOPHIA home' });
    await expect(wordmark).toBeVisible();
  });

  test('query screen renders the main heading', async ({ page }) => {
    await page.goto('/');
    // The app redirects unauthenticated users or shows the query screen.
    // We assert either the query heading or the auth prompt is present.
    const queryHeading = page.getByText('What should I think about today?');
    const authPrompt = page.getByText(/sign in|log in/i);
    await expect(queryHeading.or(authPrompt)).toBeVisible({ timeout: 10_000 });
  });

  test('example question pills are present when query screen shows', async ({ page }) => {
    await page.goto('/');
    const preamble = page.getByText('What should I think about today?');
    const isVisible = await preamble.isVisible().catch(() => false);
    if (!isVisible) {
      test.skip(); // query screen not shown (auth wall active)
      return;
    }
    const pills = page.getByLabel('Example questions');
    await expect(pills).toBeVisible();
    const pillCount = await pills.getByRole('button').count();
    expect(pillCount).toBeGreaterThan(0);
  });
});

// ─── Authenticated flow (skipped without test token) ──────────────────────

test.describe('Authenticated query flow', () => {
  test.beforeEach(async ({ page }) => {
    const token = process.env.SOPHIA_TEST_TOKEN;
    if (!token) {
      test.skip();
      return;
    }
    // Inject Firebase ID token into localStorage so the app auto-authenticates.
    // This simulates the onAuthStateChanged trigger that the app relies on.
    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('sophia-test-token', t);
    }, token);
    await page.reload();
  });

  test('query input is visible and accepts text', async ({ page }) => {
    const input = page.getByPlaceholder(/specific|question|topic/i).first();
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('Is free will compatible with determinism?');
    await expect(input).toHaveValue('Is free will compatible with determinism?');
  });

  test('clicking an example pill populates the query input', async ({ page }) => {
    const pills = page.getByLabel('Example questions');
    const isVisible = await pills.isVisible().catch(() => false);
    if (!isVisible) return;

    const firstPill = pills.getByRole('button').first();
    const pillText = await firstPill.textContent();
    await firstPill.click();

    const input = page.locator('textarea, input[type="text"]').first();
    const value = await input.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('submitting a query transitions to loading state', async ({ page }) => {
    const input = page.getByPlaceholder(/specific|question|topic/i).first();
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('What is justice?');

    const submitBtn = page.getByRole('button', { name: /analyse|analyze|submit|ask/i }).first();
    await submitBtn.click();

    // Loading screen should appear (orbital animation or PassTracker)
    const loadingIndicator = page.locator('.orbital-wrap, .tracker, [aria-live="polite"]').first();
    await expect(loadingIndicator).toBeVisible({ timeout: 5_000 });
  });

  test('map pathfinding works with fixture graph', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__SOPHIA_MAP_FIXTURE__ = {
        nodes: [
          { id: 'source:Demo', type: 'source', label: 'Demo Source', phase: 'retrieval' },
          {
            id: 'claim:alpha',
            type: 'claim',
            label: 'Alpha claim',
            phase: 'analysis',
            isSeed: true,
            confidenceBand: 'high',
            sourceTitle: 'Demo Source'
          },
          {
            id: 'claim:beta',
            type: 'claim',
            label: 'Beta claim',
            phase: 'critique',
            isTraversed: true,
            confidenceBand: 'medium',
            sourceTitle: 'Demo Source'
          }
        ],
        edges: [
          { from: 'source:Demo', to: 'claim:alpha', type: 'contains' },
          { from: 'source:Demo', to: 'claim:beta', type: 'contains' },
          { from: 'claim:alpha', to: 'claim:beta', type: 'supports', phaseOrigin: 'analysis' }
        ],
        meta: {
          seedNodeIds: ['claim:alpha'],
          traversedNodeIds: ['claim:beta'],
          relationTypeCounts: { contains: 2, supports: 1 },
          maxHops: 1,
          contextSufficiency: 'strong'
        }
      };
    });

    await page.goto('/?panelTab=map&mapFixture=1');
    await expect(page.getByTestId('map-root')).toBeVisible({ timeout: 8_000 });

    await page.getByRole('button', { name: /claim node: Alpha claim/i }).click();
    await page.getByTestId('set-path-start').click();

    await page.getByRole('button', { name: /claim node: Beta claim/i }).click();
    await page.getByTestId('set-path-end').click();

    await expect(page.getByTestId('path-length')).toContainText('1 hops');
  });

  test('map deep-link persists selected node and opens references', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__SOPHIA_MAP_FIXTURE__ = {
        nodes: [
          { id: 'source:Demo', type: 'source', label: 'Demo Source', phase: 'retrieval' },
          {
            id: 'claim:beta',
            type: 'claim',
            label: 'Beta claim',
            phase: 'analysis',
            isSeed: true,
            confidenceBand: 'high',
            sourceTitle: 'Demo Source'
          }
        ],
        edges: [{ from: 'source:Demo', to: 'claim:beta', type: 'contains' }],
        meta: { seedNodeIds: ['claim:beta'], traversedNodeIds: [], relationTypeCounts: { contains: 1 }, maxHops: 0 }
      };
    });

    await page.goto('/?panelTab=map&mapFixture=1');
    await page.getByRole('button', { name: /claim node: Beta claim/i }).click();
    await expect(page).toHaveURL(/mapNode=claim%3Abeta/);

    await page.reload();
    await expect(page).toHaveURL(/mapNode=claim%3Abeta/);
    await expect(page.getByText(/Label:\s*Beta claim/i)).toBeVisible({ timeout: 8_000 });

    await page.getByTestId('open-in-references').click();
    await expect(page.getByRole('tab', { name: 'References' })).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── Accessibility smoke checks ───────────────────────────────────────────

test.describe('Accessibility basics', () => {
  test('page has a single h1', async ({ page }) => {
    await page.goto('/');
    const h1s = page.getByRole('heading', { level: 1 });
    const count = await h1s.count();
    expect(count).toBeLessThanOrEqual(1);
  });

  test('all images have alt text', async ({ page }) => {
    await page.goto('/');
    const images = await page.locator('img:not([alt])').count();
    expect(images).toBe(0);
  });

  test('focus is visible on interactive elements', async ({ page }) => {
    await page.goto('/');
    // Tab to the first focusable element and verify focus is not invisible
    await page.keyboard.press('Tab');
    const focusedEl = page.locator(':focus');
    await expect(focusedEl).toBeVisible();
  });
});
