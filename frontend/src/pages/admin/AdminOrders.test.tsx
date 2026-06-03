import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { server } from '@/test/server';
import { API_BASE } from '@/test/handlers';
import AdminOrders from './Orders';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  HelmetProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const order = {
  _id: 'o1',
  orderNumber: 'CUR-1-000001',
  user: { name: 'Buyer', email: 'buyer@example.com' },
  items: [{ _id: 'oi1' }],
  totalPrice: 100,
  paymentMethod: 'cod',
  paymentStatus: 'paid',
  status: 'delivered',
  createdAt: new Date('2026-06-01').toISOString(),
  paymentResult: { refundedAmount: 0 },
};

function mockList() {
  server.use(
    http.get(`${API_BASE}/admin/orders`, () =>
      HttpResponse.json({ data: [order], pagination: { page: 1, pages: 1, total: 1 } })
    )
  );
}

async function openRefundDialog() {
  const user = userEvent.setup();
  mockList();
  renderWithProviders(<AdminOrders />, { route: '/admin/orders' });
  const refundBtn = await screen.findByTitle('Refund');
  await user.click(refundBtn);
  expect(await screen.findByRole('heading', { name: /refund order/i })).toBeInTheDocument();
  return user;
}

beforeEach(() => localStorage.clear());

describe('AdminOrders refund dialog', () => {
  it('shows the refundable balance (total - already refunded)', async () => {
    await openRefundDialog();
    expect(screen.getByText(/Refundable balance:/i)).toHaveTextContent('100.00');
  });

  it('blank amount issues a full refund (POST without amount)', async () => {
    let body: unknown = 'NOT_CALLED';
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { refund: { paymentStatus: 'refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    await waitFor(() => expect(body).not.toBe('NOT_CALLED'));
    expect(body).toEqual({}); // no amount, no reason
  });

  it('rejects a non-positive amount without calling the API', async () => {
    let called = false;
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, () => {
        called = true;
        return HttpResponse.json({ data: { refund: { paymentStatus: 'refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.type(screen.getByRole('spinbutton'), '0');
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    // Dialog stays open (early return) and no request fired.
    expect(screen.getByRole('heading', { name: /refund order/i })).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('valid amount + reason posts { amount, reason }', async () => {
    let body: any = null;
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { refund: { paymentStatus: 'partially_refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.type(screen.getByRole('spinbutton'), '40');
    await user.type(screen.getByPlaceholderText(/optional note/i), 'damaged');
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ amount: 40, reason: 'damaged' });
  });
});
