import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import Checkout from './Checkout';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const cartItem = {
  _id: 'ci1',
  product: { _id: 'p1', seller: { _id: 's1', name: 'Shop One' } },
  quantity: 1,
  price: 50,
  addedAt: 'now',
};

const preloaded = {
  cart: {
    items: [cartItem],
    subtotal: 50,
    itemCount: 1,
    isLoading: false,
    isOpen: false,
    selectedItemIds: ['ci1'],
  },
  auth: {
    user: {
      _id: 'u1',
      name: 'Test Buyer',
      email: 'buyer@example.com',
      role: 'user',
      addresses: [
        { _id: 'a1', label: 'Home', street: '1 Main St', city: 'Townsville', state: 'CA', country: 'US', zipCode: '90001', isDefault: true },
      ],
    },
    token: null,
    isLoading: false,
    isAuthenticated: true,
    error: null,
  },
};

beforeEach(() => {
  vi.stubEnv('VITE_PAYPAL_ENABLED', 'true');
  vi.stubEnv('VITE_GCASH_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function gotoPaymentStep() {
  const user = userEvent.setup();
  renderWithProviders(<Checkout />, { preloadedState: preloaded as never, route: '/checkout' });
  // Shipping form is prefilled from the default address -> submit advances to carrier.
  await user.click(await screen.findByRole('button', { name: /continue to carrier/i }));
  // Carrier step -> continue to payment.
  await user.click(await screen.findByRole('button', { name: /continue to payment/i }));
  return user;
}

describe('Checkout payment-method selection', () => {
  it('renders PayPal, GCash, and COD options with COD selected by default', async () => {
    await gotoPaymentStep();
    expect(await screen.findByRole('radio', { name: /cash on delivery/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /paypal/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /gcash/i })).toBeInTheDocument();
  });

  it('selecting PayPal checks it and the review step reflects the choice', async () => {
    const user = await gotoPaymentStep();
    await user.click(screen.getByRole('radio', { name: /paypal/i }));
    expect(screen.getByRole('radio', { name: /paypal/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /cash on delivery/i })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /review order/i }));
    await waitFor(() => expect(screen.getByText(/PayPal/)).toBeInTheDocument());
  });
});
