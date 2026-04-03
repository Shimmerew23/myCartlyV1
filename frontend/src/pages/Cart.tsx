import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Trash2, Plus, Minus, ArrowRight, Tag, X, Store } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  fetchCart, updateCartItem, removeFromCart, clearCart, applyCoupon,
  toggleItemSelection, toggleStoreSelection, selectAllItems, deselectAllItems,
} from '@/store/slices/cartSlice';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import { CartItem } from '@/types';

interface StoreGroup {
  sellerId: string;
  storeName: string;
  storeLogo?: string;
  items: CartItem[];
}

const CartPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, coupon, isLoading, selectedItemIds } = useAppSelector((s) => s.cart);
  const { isAuthenticated } = useAppSelector((s) => s.auth);
  const [couponCode, setCouponCode] = useState('');
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  useEffect(() => { if (isAuthenticated) dispatch(fetchCart()); }, [isAuthenticated, dispatch]);

  // Group items by seller/store
  const storeGroups = useMemo<StoreGroup[]>(() => {
    const map: Record<string, StoreGroup> = {};
    for (const item of items) {
      const seller = item.product?.seller as any;
      const sellerId = seller?._id || seller || 'unknown';
      const storeName = seller?.sellerProfile?.storeName || seller?.name || 'Unknown Store';
      const storeLogo = seller?.sellerProfile?.storeLogo;
      if (!map[sellerId]) map[sellerId] = { sellerId, storeName, storeLogo, items: [] };
      map[sellerId].items.push(item);
    }
    return Object.values(map);
  }, [items]);

  // Selected items derived values
  const selectedItems = items.filter((i) => selectedItemIds.includes(i._id));
  const selectedSubtotal = selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const selectedCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);

  const discount = coupon?.code
    ? coupon.discountType === 'percentage'
      ? selectedSubtotal * ((coupon.discountValue ?? 0) / 100)
      : (coupon.discountValue ?? 0)
    : 0;
  const shipping = selectedSubtotal > 100 ? 0 : selectedSubtotal > 0 ? 9.99 : 0;
  const tax = Math.round(selectedSubtotal * 0.1 * 100) / 100;
  const total = selectedSubtotal - discount + shipping + tax;

  const allSelected = items.length > 0 && items.every((i) => selectedItemIds.includes(i._id));
  const someSelected = selectedItemIds.length > 0 && !allSelected;

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setApplyingCoupon(true);
    await dispatch(applyCoupon(couponCode));
    setApplyingCoupon(false);
    setCouponCode('');
  };

  const handleCheckout = () => {
    if (selectedItemIds.length === 0) {
      toast.error('Please select at least one item to checkout');
      return;
    }
    navigate('/checkout');
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <ShoppingBag size={48} className="text-outline mx-auto mb-4" />
        <h2 className="font-headline text-2xl font-black mb-2">Sign in to view your cart</h2>
        <p className="text-outline mb-6">Your cart is saved across devices when you're signed in</p>
        <Link to="/login" className="btn-primary">Sign In</Link>
      </div>
    );
  }

  return (
    <>
      <Helmet><title>Cart | CartLy</title></Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="font-headline text-3xl font-black tracking-tighter mb-8">
          Shopping Cart
          {items.length > 0 && (
            <span className="ml-3 text-lg font-normal text-outline">
              ({items.length} item{items.length !== 1 ? 's' : ''})
            </span>
          )}
        </h1>

        {items.length === 0 ? (
          <div className="text-center py-24">
            <ShoppingBag size={56} className="text-outline mx-auto mb-6" />
            <h2 className="font-headline text-2xl font-black mb-2">Your cart is empty</h2>
            <p className="text-outline mb-8">Add some products to get started</p>
            <Link to="/products" className="btn-primary">Browse Products</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {/* Items */}
            <div className="lg:col-span-2 space-y-6">
              {/* Select All row */}
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={() => allSelected ? dispatch(deselectAllItems()) : dispatch(selectAllItems())}
                    className="w-4 h-4 accent-primary-900 cursor-pointer"
                  />
                  <span className="text-sm font-semibold text-on-surface">
                    Select All ({items.length} item{items.length !== 1 ? 's' : ''})
                  </span>
                </label>
                <button
                  onClick={() => dispatch(clearCart())}
                  className="btn-ghost text-xs text-error hover:bg-red-50 flex items-center gap-1"
                >
                  <X size={14} /> Clear Cart
                </button>
              </div>

              {/* Store groups */}
              {storeGroups.map((group) => {
                const groupItemIds = group.items.map((i) => i._id);
                const groupAllSelected = groupItemIds.every((id) => selectedItemIds.includes(id));
                const groupSomeSelected = groupItemIds.some((id) => selectedItemIds.includes(id)) && !groupAllSelected;

                return (
                  <div key={group.sellerId} className="bg-white rounded-lg border border-outline-variant/20 shadow-card overflow-hidden">
                    {/* Store header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-low border-b border-outline-variant/15">
                      <input
                        type="checkbox"
                        checked={groupAllSelected}
                        ref={(el) => { if (el) el.indeterminate = groupSomeSelected; }}
                        onChange={() => dispatch(toggleStoreSelection(groupItemIds))}
                        className="w-4 h-4 accent-primary-900 cursor-pointer flex-shrink-0"
                      />
                      {group.storeLogo
                        ? <img src={group.storeLogo} alt={group.storeName} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                        : <Store size={16} className="text-outline flex-shrink-0" />
                      }
                      <span className="font-semibold text-sm text-on-surface">{group.storeName}</span>
                    </div>

                    {/* Items in this store */}
                    <div className="divide-y divide-outline-variant/10">
                      {group.items.map((item) => (
                        <motion.div
                          key={item._id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex gap-3 p-4"
                        >
                          {/* Item checkbox */}
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item._id)}
                            onChange={() => dispatch(toggleItemSelection(item._id))}
                            className="w-4 h-4 accent-primary-900 cursor-pointer mt-1 flex-shrink-0"
                          />

                          {/* Product image */}
                          <Link to={`/products/${item.product?.slug}`} className="w-20 h-20 flex-shrink-0 bg-surface-low rounded-md overflow-hidden">
                            <img
                              src={item.product?.images?.[0]?.url || '/placeholder.jpg'}
                              alt={item.product?.name}
                              className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                            />
                          </Link>

                          {/* Product info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <Link
                                  to={`/products/${item.product?.slug}`}
                                  className="font-semibold text-sm text-on-surface hover:text-primary-900 transition-colors line-clamp-2"
                                >
                                  {item.product?.name}
                                </Link>
                                {item.variant && (
                                  <p className="text-xs text-outline mt-0.5">{item.variant.name}: {item.variant.value}</p>
                                )}
                                <p className="text-xs text-outline mt-0.5">${item.price.toFixed(2)} each</p>
                              </div>
                              <button
                                onClick={() => dispatch(removeFromCart(item._id))}
                                className="text-outline hover:text-error transition-colors p-1 flex-shrink-0"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between mt-3">
                              <div className="flex items-center border border-outline-variant/30 rounded-md overflow-hidden">
                                <button
                                  onClick={() => dispatch(updateCartItem({ itemId: item._id, quantity: item.quantity - 1 }))}
                                  disabled={item.quantity <= 1}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-surface-container transition-colors disabled:opacity-40"
                                >
                                  <Minus size={12} />
                                </button>
                                <span className="w-10 text-center text-sm font-semibold">{item.quantity}</span>
                                <button
                                  onClick={() => dispatch(updateCartItem({ itemId: item._id, quantity: item.quantity + 1 }))}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-surface-container transition-colors"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                              <span className="font-bold text-on-surface">${(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="space-y-4">
              {/* Coupon */}
              <div className="bg-white rounded-lg border border-outline-variant/20 p-5">
                <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Tag size={14} /> Coupon Code
                </h3>
                {coupon ? (
                  <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md px-3 py-2">
                    <span className="text-xs font-bold text-success">
                      {coupon.code} — {coupon.discountType === 'percentage' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`}
                    </span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                      placeholder="COUPON CODE"
                      className="flex-1 input-box text-xs uppercase"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={applyingCoupon || !couponCode}
                      className="btn-secondary text-xs px-4 disabled:opacity-50"
                    >
                      {applyingCoupon
                        ? <div className="w-4 h-4 border-2 border-primary-900 border-t-transparent rounded-full animate-spin" />
                        : 'Apply'}
                    </button>
                  </div>
                )}
              </div>

              {/* Order Summary */}
              <div className="bg-white rounded-lg border border-outline-variant/20 p-5 space-y-3">
                <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-4">Order Summary</h3>
                <div className="flex justify-between text-sm text-on-surface-variant">
                  <span>Selected ({selectedCount} item{selectedCount !== 1 ? 's' : ''})</span>
                  <span>${selectedSubtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-success">
                    <span>Discount</span><span>-${discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-on-surface-variant">
                  <span>Shipping</span>
                  <span className={shipping === 0 && selectedSubtotal > 0 ? 'text-success font-semibold' : ''}>
                    {selectedSubtotal === 0 ? '—' : shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-on-surface-variant">
                  <span>Tax (10%)</span><span>${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-on-surface pt-3 border-t border-outline-variant/20 text-base">
                  <span>Total</span><span>${total.toFixed(2)}</span>
                </div>
                {selectedSubtotal > 0 && selectedSubtotal <= 100 && (
                  <p className="text-xs text-outline text-center">
                    Add ${(100 - selectedSubtotal).toFixed(2)} more for free shipping
                  </p>
                )}
                {selectedItemIds.length === 0 && (
                  <p className="text-xs text-outline text-center">Select items above to checkout</p>
                )}

                {/* Show how many orders will be created */}
                {selectedItemIds.length > 0 && storeGroups.filter(g => g.items.some(i => selectedItemIds.includes(i._id))).length > 1 && (
                  <div className="bg-primary-50/50 border border-primary-100 rounded-md p-2 text-xs text-primary-700 text-center">
                    {storeGroups.filter(g => g.items.some(i => selectedItemIds.includes(i._id))).length} separate orders will be created (one per store)
                  </div>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={selectedItemIds.length === 0 || isLoading}
                  className="btn-primary w-full justify-center py-4 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Proceed to Checkout <ArrowRight size={16} />
                </button>
                <Link to="/products" className="btn-ghost w-full justify-center text-xs">Continue Shopping</Link>
              </div>

              {/* Safe checkout badges */}
              <div className="text-center text-xs text-outline space-y-1">
                <p className="font-semibold">🔒 Secure Checkout</p>
                <p>256-bit SSL encryption · Stripe payments</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default CartPage;
