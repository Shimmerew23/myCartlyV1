import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test('buyer completes a Cash-on-Delivery checkout', async ({ page }) => {
  await login(page, ACCOUNTS.buyer.email, ACCOUNTS.buyer.password);

  // Browse to a seeded product and add it to the cart.
  await page.goto('/products');
  await page.getByRole('link', { name: /Premium Leather Minimalist Wallet/i }).first().click();
  await expect(page.getByRole('heading', { name: /Premium Leather Minimalist Wallet/i, level: 1 })).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // Check what product ID is in Redux before clicking.
  const productIdInRedux = await page.evaluate(() => {
    const state = (window as any).__REDUX_STORE__?.getState?.();
    return state?.products?.currentProduct?._id;
  });

  // Click Add to Cart and wait for the API response before proceeding.
  const addToCartBtn = page.locator('button.btn-primary', { hasText: /add to cart/i }).first();
  await expect(addToCartBtn).toBeEnabled();
  const cartResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/cart/add') && r.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await addToCartBtn.click();
  const cartResponse = await cartResponsePromise;
  const cartResponseBody = await cartResponse.json();
  const cartRequestBody = JSON.parse(cartResponse.request().postData() || '{}');
  expect(cartResponse.ok(), `addToCart failed: ${cartResponse.status()} ${JSON.stringify(cartResponseBody)}, productIdInRedux=${productIdInRedux}, sentProductId=${cartRequestBody.productId}`).toBeTruthy();

  // The sidebar opens and shows the product after the API call completes.

  // Cart: navigate, select the item, proceed to checkout.
  await page.goto('/cart');
  await expect(page.getByText(/Premium Leather Minimalist Wallet/i).first()).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="checkbox"]').first().check();
  // Wait for the button to be enabled (confirms selectedItemIds updated in Redux).
  await expect(page.getByRole('button', { name: /proceed to checkout/i })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: /proceed to checkout/i }).click();

  // Shipping (name + country are prefilled; fill the rest by placeholder).
  await page.getByPlaceholder('123 Main St').fill('1 Test St');
  await page.getByPlaceholder('New York').fill('Testville');
  await page.getByPlaceholder('NY').fill('CA');
  await page.getByPlaceholder('10001').fill('90001');
  await page.getByRole('button', { name: /continue to carrier/i }).click();

  // Carrier: keep "No preference" default.
  await page.getByRole('button', { name: /continue to payment/i }).click();

  // Payment: COD is the default (PayPal/GCash are env-gated off in the E2E build).
  await page.getByRole('button', { name: /review order/i }).click();

  // Review: place the order.
  await page.getByRole('button', { name: /place order/i }).click();

  // Lands on the order confirmation/detail page with a CUR-... order number.
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /^CUR-/ })).toBeVisible();
});
