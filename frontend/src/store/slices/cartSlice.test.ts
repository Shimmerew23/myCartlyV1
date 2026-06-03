import { describe, it, expect } from 'vitest';
import {
  cartReducer,
  fetchCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from './cartSlice';

const item = (id: string, price: number, qty: number) =>
  ({ _id: id, product: { _id: 'p' + id } as never, quantity: qty, price, addedAt: 'now' });

const cartPayload = (items: ReturnType<typeof item>[]) => ({
  items,
  subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
  itemCount: items.reduce((s, i) => s + i.quantity, 0),
});

describe('cartSlice math', () => {
  it('fetchCart.fulfilled populates items, subtotal, itemCount', () => {
    const payload = cartPayload([item('1', 20, 2), item('2', 5, 1)]); // 45, count 3
    const state = cartReducer(undefined, fetchCart.fulfilled(payload as never, '', undefined));
    expect(state.items).toHaveLength(2);
    expect(state.subtotal).toBe(45);
    expect(state.itemCount).toBe(3);
    expect(state.isLoading).toBe(false);
  });

  it('addToCart.fulfilled recomputes totals', () => {
    const payload = cartPayload([item('1', 10, 4)]); // 40, count 4
    const state = cartReducer(undefined, addToCart.fulfilled(payload as never, '', { productId: 'p1', quantity: 4 }));
    expect(state.subtotal).toBe(40);
    expect(state.itemCount).toBe(4);
  });

  it('updateCartItem.fulfilled reflects the new quantity totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 1)]) as never, '', undefined));
    const updated = cartReducer(start, updateCartItem.fulfilled(cartPayload([item('1', 10, 3)]) as never, '', { itemId: '1', quantity: 3 }));
    expect(updated.subtotal).toBe(30);
    expect(updated.itemCount).toBe(3);
  });

  it('removeFromCart.fulfilled drops the item from totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 1), item('2', 10, 1)]) as never, '', undefined));
    const after = cartReducer(start, removeFromCart.fulfilled(cartPayload([item('2', 10, 1)]) as never, '', '1'));
    expect(after.items).toHaveLength(1);
    expect(after.subtotal).toBe(10);
    expect(after.itemCount).toBe(1);
  });

  it('clearCart.fulfilled empties items and zeroes totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 2)]) as never, '', undefined));
    const cleared = cartReducer(start, clearCart.fulfilled(null as never, '', undefined));
    expect(cleared.items).toEqual([]);
    expect(cleared.subtotal).toBe(0);
    expect(cleared.itemCount).toBe(0);
  });

  it('prunes selectedItemIds that no longer exist after an update', () => {
    const start = cartReducer(
      { items: [], subtotal: 0, itemCount: 0, isLoading: false, isOpen: false, selectedItemIds: ['1', '2'] } as never,
      fetchCart.fulfilled(cartPayload([item('1', 10, 1)]) as never, '', undefined)
    );
    expect(start.selectedItemIds).toEqual(['1']);
  });
});
