import { expect, test } from '@playwright/test';

/**
 * E2E smoke tests for SOPHIA onboarding and shell behavior.
 *
 * Authenticated tests require SOPHIA_TEST_TOKEN; without it they are skipped.
 */

test.describe('Public shell', () => {
  test('home page loads and shows landing CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SOPHIA/i);
    await expect(page.getByRole('link', { name: /sign in to get started/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /see learn \+ inquire paths/i })).toBeVisible();
  });

  test('legal footer navigation is visible on public pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Legal links' })).toBeVisible();
  });

  test('wordmark link is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /sophia/i }).first()).toBeVisible();
  });
});

test.describe('Authenticated onboarding flow', () => {
  test.beforeEach(async ({ page }) => {
    const token = process.env.SOPHIA_TEST_TOKEN;
    if (!token) {
      test.skip();
      return;
    }

    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('sophia-test-token', t);
    }, token);
    await page.goto('/app');
  });

  test('query screen loads with advanced options collapsed', async ({ page }) => {
    await expect(page.getByTestId('query-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('advanced-toggle')).toBeVisible();
    await expect(page.getByText('Thinking Engine')).toHaveCount(0);
  });

  test('advanced options expand from query screen', async ({ page }) => {
    await expect(page.getByTestId('query-screen')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('advanced-toggle').click();
    await expect(page.getByText('Thinking Engine')).toBeVisible();
    await expect(page.getByText('Reasoning Focus')).toBeVisible();
  });

  test('simple flow reveals synthesis then overview then scholar view', async ({ page }) => {
    const input = page.getByPlaceholder(/ask a question/i).first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Is suffering necessary for meaning?');

    await page.getByRole('button', { name: /begin inquiry/i }).click();
    await expect(page.getByTestId('simple-synthesis-card')).toBeVisible({ timeout: 120_000 });

    await page.getByTestId('see-reasoning-btn').click();
    await expect(page.getByTestId('simple-overview-card')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('open-scholar-btn').click();
    await expect(page.getByRole('navigation', { name: 'Pass navigation' })).toBeVisible({ timeout: 10_000 });
  });

  test('quote card generator exposes download and copy actions', async ({ page }) => {
    const input = page.getByPlaceholder(/ask a question/i).first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('What makes a life meaningful?');

    await page.getByRole('button', { name: /begin inquiry/i }).click();
    await expect(page.getByTestId('simple-synthesis-card')).toBeVisible({ timeout: 120_000 });

    await page.getByTestId('quote-card-generate').click();
    await expect(page.getByTestId('quote-card-preview')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('quote-card-download')).toBeVisible();
    await expect(page.getByTestId('quote-card-copy')).toBeVisible();
  });
});
