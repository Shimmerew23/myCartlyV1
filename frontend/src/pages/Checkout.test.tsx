import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import Checkout from './Checkout';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// react-helmet-async requires a HelmetProvider context that renderWithProviders
// does not supply. Mock it to a no-op so the component renders without error.
vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  HelmetProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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

describe('Checkout payment-method selection', () => {
  it('renders PayPal, GCash, and COD options with COD selected by default', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Checkout />, { preloadedState: preloaded as never, route: '/checkout' });
    // Shipping form is prefilled from the default address -> submit advances to carrier.
    await user.click(await screen.findByRole('button', { name: /continue to carrier/i }));
    // Carrier step -> continue to payment.
    await user.click(await screen.findByRole('button', { name: /continue to payment/i }));

    // Try role-based query first; fall back to value-based if the label text is not accessible.
    const codByRole = screen.queryByRole('radio', { name: /cash on delivery/i });
    if (codByRole) {
      expect(codByRole).toBeChecked();
      expect(screen.getByRole('radio', { name: /paypal/i })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: /gcash/i })).toBeInTheDocument();
    } else {
      const cod = container.querySelector('input[name="payment"][value="cod"]') as HTMLInputElement;
      const paypal = container.querySelector('input[name="payment"][value="paypal"]') as HTMLInputElement;
      const gcash = container.querySelector('input[name="payment"][value="gcash"]') as HTMLInputElement;
      expect(cod).toBeChecked();
      expect(paypal).not.toBeChecked();
      expect(gcash).toBeInTheDocument();
    }
  });

  it('selecting PayPal checks it and the review step reflects the choice', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Checkout />, { preloadedState: preloaded as never, route: '/checkout' });
    // Navigate to payment step.
    await user.click(await screen.findByRole('button', { name: /continue to carrier/i }));
    await user.click(await screen.findByRole('button', { name: /continue to payment/i }));

    // Try role-based query; fall back to value-based.
    const paypalByRole = screen.queryByRole('radio', { name: /paypal/i });
    if (paypalByRole) {
      await user.click(paypalByRole);
      expect(paypalByRole).toBeChecked();
      expect(screen.getByRole('radio', { name: /cash on delivery/i })).not.toBeChecked();
    } else {
      const paypal = container.querySelector('input[name="payment"][value="paypal"]') as HTMLInputElement;
      const cod = container.querySelector('input[name="payment"][value="cod"]') as HTMLInputElement;
      await user.click(paypal);
      expect(paypal).toBeChecked();
      expect(cod).not.toBeChecked();
    }

    // Advance to review and confirm the payment summary shows PayPal.
    await user.click(screen.getByRole('button', { name: /review order/i }));
    await waitFor(() => expect(screen.getByText(/PayPal/)).toBeInTheDocument());
  });
});
