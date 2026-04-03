import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, Lock, CreditCard, Truck, ChevronDown, ChevronUp, Store } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { clearCart, deselectAllItems } from '@/store/slices/cartSlice';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import { Carrier, CartItem } from '@/types';

const addressSchema = z.object({
  name: z.string().min(2, 'Name required'),
  street: z.string().min(3, 'Street required'),
  city: z.string().min(2, 'City required'),
  state: z.string().min(2, 'State required'),
  country: z.string().min(2, 'Country required'),
  zipCode: z.string().min(3, 'ZIP required'),
  phone: z.string().optional(),
});

type AddressForm = z.infer<typeof addressSchema>;
type Step = 'shipping' | 'carrier' | 'payment' | 'review';

interface StoreGroup {
  sellerId: string;
  storeName: string;
  items: CartItem[];
  itemIds: string[];
}

const CheckoutPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, coupon, selectedItemIds } = useAppSelector((s) => s.cart);
  const { user } = useAppSelector((s) => s.auth);
  const [step, setStep] = useState<Step>('shipping');
  const [shippingAddress, setShippingAddress] = useState<AddressForm | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'cod'>('stripe');
  const [placing, setPlacing] = useState(false);
  const [orderSummaryOpen, setOrderSummaryOpen] = useState(false);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');

  // Only the selected items go to checkout
  const selectedItems = useMemo(
    () => items.filter((i) => selectedItemIds.includes(i._id)),
    [items, selectedItemIds]
  );

  // Group selected items by seller/store
  const storeGroups = useMemo<StoreGroup[]>(() => {
    const map: Record<string, StoreGroup> = {};
    for (const item of selectedItems) {
      const seller = item.product?.seller as any;
      const sellerId = seller?._id || seller || 'unknown';
      const storeName = seller?.sellerProfile?.storeName || seller?.name || 'Unknown Store';
      if (!map[sellerId]) map[sellerId] = { sellerId, storeName, items: [], itemIds: [] };
      map[sellerId].items.push(item);
      map[sellerId].itemIds.push(item._id);
    }
    return Object.values(map);
  }, [selectedItems]);

  const safeSubtotal = selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const discount = coupon
    ? coupon.discountType === 'percentage'
      ? safeSubtotal * ((Number(coupon.discountValue) || 0) / 100)
      : Number(coupon.discountValue) || 0
    : 0;
  const shipping = safeSubtotal > 100 ? 0 : 9.99;
  const tax = Math.round(safeSubtotal * 0.1 * 100) / 100;
  const total = safeSubtotal - discount + shipping + tax;

  const defaultAddr = user?.addresses?.find((a) => a.isDefault);
  const { register, handleSubmit, formState: { errors } } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      name: user?.name || '',
      street: defaultAddr?.street || '',
      city: defaultAddr?.city || '',
      state: defaultAddr?.state || '',
      country: defaultAddr?.country || 'US',
      zipCode: defaultAddr?.zipCode || '',
    },
  });

  useEffect(() => {
    api.get('/carriers').then(({ data }) => setCarriers(data.data || [])).catch(() => {});
  }, []);

  // Redirect back to cart if nothing selected
  useEffect(() => {
    if (items.length > 0 && selectedItemIds.length === 0) {
      navigate('/cart');
    }
  }, [items.length, selectedItemIds.length, navigate]);

  const onAddressSubmit = (data: AddressForm) => { setShippingAddress(data); setStep('carrier'); };

  const placeOrder = async () => {
    if (!shippingAddress) return;
    setPlacing(true);
    try {
      const createdOrders: any[] = [];

      // Create one order per store group
      for (const group of storeGroups) {
        const { data } = await api.post('/orders', {
          shippingAddress,
          paymentMethod,
          preferredCarrier: selectedCarrier || undefined,
          selectedItemIds: group.itemIds,
        });
        createdOrders.push(data.data.order);
      }

      dispatch(clearCart());
      dispatch(deselectAllItems());

      if (createdOrders.length === 1) {
        toast.success('Order placed successfully!');
        navigate(`/orders/${createdOrders[0]._id}`);
      } else {
        toast.success(`${createdOrders.length} orders placed successfully!`);
        navigate('/orders');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Order failed. Please try again.');
    }
    setPlacing(false);
  };

  const steps: { key: Step; label: string }[] = [
    { key: 'shipping', label: 'Shipping' },
    { key: 'carrier', label: 'Carrier' },
    { key: 'payment', label: 'Payment' },
    { key: 'review', label: 'Review' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  return (
    <>
      <Helmet><title>Checkout | CartLy</title></Helmet>
      <div className="min-h-screen bg-surface-low">
        <div className="bg-white border-b border-outline-variant/20 px-4 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <span className="font-headline font-black text-lg tracking-tighter">CartLy</span>
            <div className="flex items-center gap-2 text-xs text-outline"><Lock size={12} /><span>Secure Checkout</span></div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {/* Step Progress */}
            <div className="flex items-center">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center flex-1 last:flex-none">
                  <div className={`flex items-center gap-2 ${step === s.key ? 'text-primary-900' : i < currentStepIndex ? 'text-success' : 'text-outline'}`}>
                    <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ${step === s.key ? 'bg-primary-900 text-white' : i < currentStepIndex ? 'bg-success text-white' : 'bg-surface-container text-outline'}`}>{i + 1}</div>
                    <span className="text-xs font-semibold hidden sm:block">{s.label}</span>
                  </div>
                  {i < steps.length - 1 && <div className="flex-1 h-px bg-outline-variant/20 mx-3" />}
                </div>
              ))}
            </div>

            {/* Step 1 — Shipping Address */}
            {step === 'shipping' && (
              <div className="bg-white rounded-lg p-6 border border-outline-variant/20">
                <h2 className="font-headline font-black text-lg mb-5 flex items-center gap-2"><Truck size={18} /> Shipping Address</h2>
                <form onSubmit={handleSubmit(onAddressSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2"><label className="label-sm block mb-1.5">Full Name</label><input {...register('name')} className="input-box text-sm" placeholder="John Smith" />{errors.name && <p className="text-xs text-error mt-1">{errors.name.message}</p>}</div>
                    <div className="sm:col-span-2"><label className="label-sm block mb-1.5">Street Address</label><input {...register('street')} className="input-box text-sm" placeholder="123 Main St" />{errors.street && <p className="text-xs text-error mt-1">{errors.street.message}</p>}</div>
                    <div><label className="label-sm block mb-1.5">City</label><input {...register('city')} className="input-box text-sm" placeholder="New York" />{errors.city && <p className="text-xs text-error mt-1">{errors.city.message}</p>}</div>
                    <div><label className="label-sm block mb-1.5">State / Province</label><input {...register('state')} className="input-box text-sm" placeholder="NY" />{errors.state && <p className="text-xs text-error mt-1">{errors.state.message}</p>}</div>
                    <div><label className="label-sm block mb-1.5">ZIP / Postal Code</label><input {...register('zipCode')} className="input-box text-sm" placeholder="10001" />{errors.zipCode && <p className="text-xs text-error mt-1">{errors.zipCode.message}</p>}</div>
                    <div><label className="label-sm block mb-1.5">Country</label><input {...register('country')} className="input-box text-sm" placeholder="US" /></div>
                    <div className="sm:col-span-2"><label className="label-sm block mb-1.5">Phone (optional)</label><input {...register('phone')} className="input-box text-sm" placeholder="+1 555 000 0000" /></div>
                  </div>
                  <button type="submit" className="btn-primary w-full justify-center py-3.5">Continue to Carrier →</button>
                </form>
              </div>
            )}

            {/* Step 2 — Carrier Selection */}
            {step === 'carrier' && (
              <div className="bg-white rounded-lg p-6 border border-outline-variant/20 space-y-5">
                <h2 className="font-headline font-black text-lg flex items-center gap-2"><Truck size={18} /> Preferred Carrier</h2>
                <p className="text-xs text-outline">Select your preferred shipping carrier. The seller will try to fulfill your preference, but may use another carrier if unavailable.</p>
                <div className="space-y-3">
                  <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedCarrier === '' ? 'border-primary-900 bg-primary-50/40' : 'border-outline-variant/30 hover:border-outline-variant'}`}>
                    <input type="radio" name="carrier" value="" checked={selectedCarrier === ''} onChange={() => setSelectedCarrier('')} className="accent-primary-900" />
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-on-surface">No preference</p>
                      <p className="text-xs text-outline">Let the seller choose the best carrier</p>
                    </div>
                  </label>
                  {carriers.map((c) => (
                    <label key={c._id} className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedCarrier === c.name ? 'border-primary-900 bg-primary-50/40' : 'border-outline-variant/30 hover:border-outline-variant'}`}>
                      <input type="radio" name="carrier" value={c.name} checked={selectedCarrier === c.name} onChange={() => setSelectedCarrier(c.name)} className="accent-primary-900" />
                      {c.logoUrl
                        ? <img src={c.logoUrl} alt={c.name} className="w-10 h-10 object-contain flex-shrink-0" />
                        : <div className="w-10 h-10 rounded bg-surface-container flex items-center justify-center text-xs font-bold text-outline flex-shrink-0">{c.name[0]}</div>
                      }
                      <p className="font-semibold text-sm text-on-surface">{c.name}</p>
                    </label>
                  ))}
                  {carriers.length === 0 && (
                    <p className="text-xs text-outline text-center py-4">No carriers configured. The seller will choose the best option.</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('shipping')} className="btn-secondary flex-1 justify-center">← Back</button>
                  <button onClick={() => setStep('payment')} className="btn-primary flex-1 justify-center">Continue to Payment →</button>
                </div>
              </div>
            )}

            {/* Step 3 — Payment */}
            {step === 'payment' && (
              <div className="bg-white rounded-lg p-6 border border-outline-variant/20 space-y-5">
                <h2 className="font-headline font-black text-lg flex items-center gap-2"><CreditCard size={18} /> Payment Method</h2>
                <div className="space-y-3">
                  {[
                    { key: 'stripe', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, Amex via Stripe', emoji: '💳' },
                    { key: 'cod', label: 'Cash on Delivery', sub: 'Pay when your order arrives', emoji: '📦' },
                  ].map((m) => (
                    <label key={m.key} className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${paymentMethod === m.key ? 'border-primary-900 bg-primary-50/40' : 'border-outline-variant/30 hover:border-outline-variant'}`}>
                      <input type="radio" name="payment" value={m.key} checked={paymentMethod === m.key as any} onChange={() => setPaymentMethod(m.key as any)} className="accent-primary-900" />
                      <span className="text-xl">{m.emoji}</span>
                      <div className="flex-1"><p className="font-semibold text-sm text-on-surface">{m.label}</p><p className="text-xs text-outline">{m.sub}</p></div>
                    </label>
                  ))}
                </div>
                {paymentMethod === 'stripe' && (
                  <div className="bg-primary-50/50 border border-primary-100 rounded-md p-3 text-xs text-primary-700">
                    <Shield size={12} className="inline mr-1" />Your card details are encrypted and processed securely by Stripe. We never store your card information.
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setStep('carrier')} className="btn-secondary flex-1 justify-center">← Back</button>
                  <button onClick={() => setStep('review')} className="btn-primary flex-1 justify-center">Review Order →</button>
                </div>
              </div>
            )}

            {/* Step 4 — Review */}
            {step === 'review' && (
              <div className="bg-white rounded-lg p-6 border border-outline-variant/20 space-y-5">
                <h2 className="font-headline font-black text-lg">Review Your Order</h2>

                {/* Shipping / carrier / payment summary */}
                <div className="border border-outline-variant/20 rounded-md divide-y divide-outline-variant/10">
                  <div className="p-4">
                    <p className="label-sm mb-2 flex items-center gap-2"><Truck size={12} /> Shipping To</p>
                    <p className="text-sm font-semibold text-on-surface">{shippingAddress?.name}</p>
                    <p className="text-sm text-outline">{shippingAddress?.street}, {shippingAddress?.city}, {shippingAddress?.state} {shippingAddress?.zipCode}, {shippingAddress?.country}</p>
                    <button onClick={() => setStep('shipping')} className="text-xs text-primary-700 font-semibold mt-1 hover:text-primary-900">Edit →</button>
                  </div>
                  <div className="p-4">
                    <p className="label-sm mb-1 flex items-center gap-2"><Truck size={12} /> Carrier Preference</p>
                    <p className="text-sm text-on-surface">{selectedCarrier || 'No preference'}</p>
                    <button onClick={() => setStep('carrier')} className="text-xs text-primary-700 font-semibold mt-1 hover:text-primary-900">Edit →</button>
                  </div>
                  <div className="p-4">
                    <p className="label-sm mb-1 flex items-center gap-2"><CreditCard size={12} /> Payment</p>
                    <p className="text-sm text-on-surface">{paymentMethod === 'stripe' ? '💳 Credit/Debit Card via Stripe' : '📦 Cash on Delivery'}</p>
                    <button onClick={() => setStep('payment')} className="text-xs text-primary-700 font-semibold mt-1 hover:text-primary-900">Edit →</button>
                  </div>
                </div>

                {/* Items grouped by store */}
                <div className="space-y-4">
                  {storeGroups.map((group) => (
                    <div key={group.sellerId} className="border border-outline-variant/20 rounded-md overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2 bg-surface-low border-b border-outline-variant/10">
                        <Store size={13} className="text-outline" />
                        <span className="text-xs font-semibold text-on-surface-variant">{group.storeName}</span>
                        <span className="ml-auto text-xs text-outline">Order {storeGroups.indexOf(group) + 1} of {storeGroups.length}</span>
                      </div>
                      <div className="divide-y divide-outline-variant/10">
                        {group.items.map((item) => (
                          <div key={item._id} className="flex items-center gap-3 px-4 py-3">
                            <img
                              src={item.product?.images?.[0]?.url || '/placeholder.jpg'}
                              alt={item.product?.name}
                              className="w-12 h-12 rounded-md object-cover flex-shrink-0 border border-outline-variant/10"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-on-surface truncate">{item.product?.name}</p>
                              <p className="text-xs text-outline">Qty: {item.quantity} × ${item.price.toFixed(2)}</p>
                            </div>
                            <span className="text-sm font-bold">${(item.price * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {storeGroups.length > 1 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-700">
                    Items from {storeGroups.length} different stores will create {storeGroups.length} separate orders with the same shipping address and payment method.
                  </div>
                )}

                <div className="flex gap-3 pt-2 border-t border-outline-variant/10">
                  <button onClick={() => setStep('payment')} className="btn-secondary flex-1 justify-center">← Back</button>
                  <button onClick={placeOrder} disabled={placing} className="btn-primary flex-1 justify-center">
                    {placing
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : storeGroups.length > 1
                        ? `Place ${storeGroups.length} Orders • $${total.toFixed(2)}`
                        : `Place Order • $${total.toFixed(2)}`
                    }
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary sidebar */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-outline-variant/20 sticky top-4">
              <button
                onClick={() => setOrderSummaryOpen(!orderSummaryOpen)}
                className="w-full flex items-center justify-between p-5 lg:pointer-events-none"
              >
                <span className="font-headline font-black text-sm uppercase tracking-wider">
                  Summary ({selectedItems.length})
                </span>
                <span className="lg:hidden">{orderSummaryOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
              </button>
              <div className={`${orderSummaryOpen ? 'block' : 'hidden lg:block'}`}>
                {/* Items grouped by store in sidebar */}
                <div className="max-h-64 overflow-y-auto px-5">
                  {storeGroups.map((group) => (
                    <div key={group.sellerId} className="mb-3">
                      <p className="text-[10px] font-bold uppercase text-outline tracking-wider mb-1 flex items-center gap-1">
                        <Store size={10} /> {group.storeName}
                      </p>
                      {group.items.map((item) => (
                        <div key={item._id} className="flex items-center gap-3 py-2 border-b border-outline-variant/10 last:border-0">
                          <div className="relative w-10 h-10 flex-shrink-0">
                            <img
                              src={item.product?.images?.[0]?.url || '/placeholder.jpg'}
                              alt={item.product?.name}
                              className="w-full h-full rounded-md object-cover border border-outline-variant/10"
                            />
                            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-on-surface text-white text-[9px] font-bold rounded-full flex items-center justify-center">{item.quantity}</span>
                          </div>
                          <p className="flex-1 text-xs text-on-surface line-clamp-2">{item.product?.name}</p>
                          <span className="text-xs font-bold flex-shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-outline-variant/10 space-y-2 text-sm">
                  <div className="flex justify-between text-on-surface-variant"><span>Subtotal</span><span>${safeSubtotal.toFixed(2)}</span></div>
                  {discount > 0 && <div className="flex justify-between text-success font-semibold"><span>Discount</span><span>-${discount.toFixed(2)}</span></div>}
                  <div className="flex justify-between text-on-surface-variant"><span>Shipping</span><span className={shipping === 0 ? 'text-success font-semibold' : ''}>{shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`}</span></div>
                  <div className="flex justify-between text-on-surface-variant"><span>Tax (10%)</span><span>${tax.toFixed(2)}</span></div>
                  <div className="flex justify-between font-bold text-on-surface text-base border-t border-outline-variant/10 pt-2 mt-1"><span>Total</span><span>${total.toFixed(2)}</span></div>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-outline-variant/10 flex items-center justify-center gap-2 text-xs text-outline">
                <Shield size={12} /><span>Powered by Stripe</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CheckoutPage;
