import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('seller dashboard renders for a seller', async ({ page }) => {
  await login(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
  await page.goto('/seller/dashboard');
  await expect(page.getByRole('heading', { name: /seller dashboard/i })).toBeVisible({ timeout: 15_000 });
});
