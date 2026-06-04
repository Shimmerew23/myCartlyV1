import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('admin issues a full refund on a paid order', async ({ page }) => {
  await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);

  await page.goto('/admin/orders');

  // The seeded paid order row (E2E-REFUND-0001) is refundable -> has a Refund action.
  const row = page.locator('tr', { hasText: 'E2E-REFUND-0001' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTitle('Refund').click();

  // Refund dialog -> issue a full refund (blank amount).
  await expect(page.getByRole('heading', { name: /refund order/i })).toBeVisible();
  await page.getByRole('button', { name: /issue refund/i }).click();

  // Dialog closes and the row's payment status reflects the refund.
  await expect(page.getByRole('heading', { name: /refund order/i })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('tr', { hasText: 'E2E-REFUND-0001' })).toContainText(/refunded/i);
});
