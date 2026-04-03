import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Trash2, Plus, Minus, ArrowRight } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { closeCart, updateCartItem, removeFromCart } from '@/store/slices/cartSlice';

const CartSidebar = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, subtotal, itemCount, isOpen, coupon } = useAppSelector((s) => s.cart);
  const { isAuthenticated } = useAppSelector((s) => s.auth);

  const handleCheckout = () => {
    dispatch(closeCart());
    if (!isAuthenticated) { navigate('/login'); return; }
    navigate('/checkout');
  };

  const safeSubtotal = Number(subtotal) || 0;
  const discount = coupon
    ? coupon.discountType === 'percentage'
      ? safeSubtotal * (coupon.discountValue / 100)
      : Number(coupon.discountValue) || 0
    : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={() => dispatch(closeCart())}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/20">
              <div className="flex items-center gap-3">
                <ShoppingBag size={18} className="text-primary-900" />
                <div>
                  <h2 className="font-headline font-black text-sm uppercase tracking-wider">Your Cart</h2>
                  <p className="text-xs text-outline">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                onClick={() => dispatch(closeCart())}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center">
                    <ShoppingBag size={24} className="text-outline" />
                  </div>
                  <div>
                    <p className="font-headline font-bold text-on-surface">Your cart is empty</p>
                    <p className="text-sm text-outline mt-1">Add some products to get started</p>
                  </div>
                  <button
                    onClick={() => { dispatch(closeCart()); navigate('/products'); }}
                    className="btn-primary text-xs mt-2"
                  >
                    Browse Products
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-outline-variant/10">
                  {items.map((item) => (
                    <div key={item._id} className="flex gap-4 px-6 py-4">
                      <div className="w-20 h-20 flex-shrink-0 bg-surface-low rounded-md overflow-hidden">
                        <img
                          src={item.product?.images?.[0]?.url || '/placeholder.jpg'}
                          alt={item.product?.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-on-surface line-clamp-2 leading-snug">
                          {item.product?.name}
                        </h4>
                        {item.variant && (
                          <p className="text-xs text-outline mt-0.5">
                            {item.variant.name}: {item.variant.value}
                          </p>
                        )}
                        <p className="text-sm font-bold text-primary-900 mt-1">
                          ${(item.price * item.quantity).toFixed(2)}
                        </p>

                        <div className="flex items-center justify-between mt-2">
                          {/* Quantity controls */}
                          <div className="flex items-center gap-2 border border-outline-variant/30 rounded-md overflow-hidden">
                            <button
                              onClick={() => dispatch(updateCartItem({ itemId: item._id, quantity: item.quantity - 1 }))}
                              className="w-7 h-7 flex items-center justify-center hover:bg-surface-container transition-colors"
                              disabled={item.quantity <= 1}
                            >
                              <Minus size={12} />
                            </button>
                            <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                            <button
                              onClick={() => dispatch(updateCartItem({ itemId: item._id, quantity: item.quantity + 1 }))}
                              className="w-7 h-7 flex items-center justify-center hover:bg-surface-container transition-colors"
                            >
                              <Plus size={12} />
                            </button>
                          </div>

                          <button
                            onClick={() => dispatch(removeFromCart(item._id))}
                            className="w-7 h-7 flex items-center justify-center text-outline hover:text-error transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-outline-variant/20 px-6 py-5 bg-surface-low/50">
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm text-on-surface-variant">
                    <span>Subtotal</span>
                    <span>${safeSubtotal.toFixed(2)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm text-success">
                      <span>Discount ({coupon?.code})</span>
                      <span>-${discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-on-surface-variant">
                    <span>Shipping</span>
                    <span className="text-success">{safeSubtotal > 100 ? 'Free' : '$9.99'}</span>
                  </div>
                  <div className="flex justify-between font-bold text-on-surface pt-2 border-t border-outline-variant/20">
                    <span>Total</span>
                    <span>${(safeSubtotal - discount + (safeSubtotal > 100 ? 0 : 9.99)).toFixed(2)}</span>
                  </div>
                </div>

                <button onClick={handleCheckout} className="btn-primary w-full justify-center">
                  Checkout <ArrowRight size={16} />
                </button>
                <button
                  onClick={() => { dispatch(closeCart()); navigate('/cart'); }}
                  className="btn-ghost w-full justify-center mt-2 text-xs"
                >
                  View Full Cart
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CartSidebar;
