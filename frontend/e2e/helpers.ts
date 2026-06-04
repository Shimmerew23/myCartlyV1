import { Page, expect } from '@playwright/test';

export const ACCOUNTS = {
  buyer: { email: 'user@cartly.com', password: 'User@123456' },
  admin: { email: 'admin@cartly.com', password: 'Admin@123456' },
  seller: { email: 'seller@cartly.com', password: 'Seller@123456' },
};

// Drives the real /login form, then waits for the post-login redirect off /login.
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}
