import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Truck, CheckCircle, XCircle, RotateCcw, ArrowLeft, MapPin, CreditCard, ExternalLink, Navigation } from 'lucide-react';
import api from '@/api/axios';
import { Order } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const STATUS_TIMELINE = ['pending','confirmed','processing','shipped','out_for_delivery','delivered'];

const IN_TRANSIT_STATUSES = new Set(['shipped', 'out_for_delivery']);

const OrderDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    api.get(`/orders/${id}`).then(({ data }) => setOrder(data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const handleReturn = async () => {
    const reason = prompt('Reason for return:');
    if (!reason) return;
    setReturning(true);
    try {
      await api.post(`/orders/${id}/return`, { reason });
      toast.success('Return request submitted!');
      // Optimistic update — avoid a second GET
      setOrder((prev) => prev ? {
        ...prev,
        status: 'return_requested',
        returnReason: reason,
        statusHistory: [...prev.statusHistory, { status: 'return_requested', timestamp: new Date().toISOString(), note: reason }],
      } : prev);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Return failed'); }
    setReturning(false);
  };

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">{[...Array(5)].map((_, i) => <div key={i} className="h-20 skeleton rounded-lg" />)}</div>;
  if (!order) return <div className="text-center py-20"><p className="text-outline">Order not found</p><Link to="/orders" className="btn-primary mt-4">Back to Orders</Link></div>;

  const currentStep = STATUS_TIMELINE.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';
  const isInTransit = IN_TRANSIT_STATUSES.has(order.status);

  return (
    <>
      <Helmet><title>{order.orderNumber} | CartLy</title></Helmet>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/orders" className="btn-ghost text-xs"><ArrowLeft size={14} /> Orders</Link>
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">{order.orderNumber}</h1>
            <p className="text-xs text-outline">Placed {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        {/* In Transit Banner */}
        {isInTransit && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <p className="font-semibold text-blue-800 text-sm">
                {order.status === 'out_for_delivery' ? 'Out for Delivery' : 'In Transit'}
              </p>
            </div>
            {order.tracking?.trackingNumber && (
              <div className="space-y-1">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">{order.tracking.carrier}</span>
                  {' · '}
                  <span className="font-mono">{order.tracking.trackingNumber}</span>
                </p>
                {order.tracking.lastLocation && (
                  <p className="text-xs text-blue-700 flex items-center gap-1">
                    <Navigation size={11} />
                    Last known location: <strong>{order.tracking.lastLocation}</strong>
                    {order.tracking.lastLocationUpdatedAt && (
                      <span className="text-blue-500 ml-1">
                        · {new Date(order.tracking.lastLocationUpdatedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                )}
                {order.tracking.estimatedDelivery && (
                  <p className="text-xs text-blue-600">
                    Estimated delivery: {new Date(order.tracking.estimatedDelivery).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
            {order.tracking?.trackingUrl && (
              <a
                href={order.tracking.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
              >
                <ExternalLink size={12} />
                Track on {order.tracking.carrier || 'carrier website'}
              </a>
            )}
            {!order.tracking?.trackingNumber && (
              <p className="text-xs text-blue-600">Tracking information will be available once the seller ships your order.</p>
            )}
          </div>
        )}

        {/* Status Timeline */}
        {!isCancelled && (
          <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
            <h2 className="font-headline font-black text-sm uppercase tracking-wider mb-5">Order Status</h2>
            <div className="flex items-center">
              {STATUS_TIMELINE.map((s, i) => {
                const done = i <= currentStep;
                const active = i === currentStep;
                return (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${done ? 'bg-primary-900 text-white' : 'bg-surface-container text-outline'}`}>
                        {done ? <CheckCircle size={14} /> : i + 1}
                      </div>
                      <span className={`text-[10px] text-center capitalize hidden sm:block ${active ? 'text-primary-900 font-bold' : done ? 'text-on-surface' : 'text-outline'}`}>{s.replace(/_/g,' ')}</span>
                    </div>
                    {i < STATUS_TIMELINE.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${i < currentStep ? 'bg-primary-900' : 'bg-surface-container'}`} />}
                  </div>
                );
              })}
            </div>
            {/* Compact tracking row (non-transit orders that were shipped) */}
            {!isInTransit && order.tracking?.trackingNumber && (
              <div className="mt-4 p-3 bg-surface-container rounded-md">
                <p className="text-xs font-semibold text-on-surface">Shipped via: <span className="font-normal">{order.tracking.carrier} — {order.tracking.trackingNumber}</span></p>
                {order.tracking.trackingUrl && (
                  <a href={order.tracking.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-700 underline mt-0.5 inline-flex items-center gap-1 hover:text-primary-900">
                    <ExternalLink size={11} /> Track package
                  </a>
                )}
              </div>
            )}
            {order.preferredCarrier && !order.tracking?.trackingNumber && order.status === 'processing' && (
              <p className="text-xs text-outline mt-3">You requested: <strong>{order.preferredCarrier}</strong></p>
            )}
          </div>
        )}

        {isCancelled && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-error flex items-center gap-2"><XCircle size={14} /> Order Cancelled</p>
            {order.cancellationReason && <p className="text-xs text-red-600 mt-1">Reason: {order.cancellationReason}</p>}
          </div>
        )}

        {/* Items */}
        <div className="bg-white rounded-lg border border-outline-variant/20 overflow-hidden">
          <div className="px-5 py-4 border-b border-outline-variant/10"><h2 className="font-headline font-black text-sm uppercase tracking-wider">Items ({order.items.length})</h2></div>
          <div className="divide-y divide-outline-variant/10">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-14 h-14 rounded-md overflow-hidden bg-surface-low flex-shrink-0">
                  <img src={item.image || '/placeholder.jpg'} alt={item.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{item.name}</p>
                  {item.variant && <p className="text-xs text-outline">{item.variant.name}: {item.variant.value}</p>}
                  <p className="text-xs text-outline">Qty: {item.quantity} × ${item.price.toFixed(2)}</p>
                </div>
                <span className="font-bold text-on-surface text-sm">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Info row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-outline-variant/20 p-5">
            <h3 className="font-headline font-black text-xs uppercase tracking-wider mb-3 flex items-center gap-2"><MapPin size={13} /> Shipping Address</h3>
            <p className="text-sm font-semibold text-on-surface">{order.shippingAddress.name}</p>
            <p className="text-sm text-outline">{order.shippingAddress.street}</p>
            <p className="text-sm text-outline">{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zipCode}</p>
            <p className="text-sm text-outline">{order.shippingAddress.country}</p>
            {order.preferredCarrier && (
              <p className="text-xs text-outline mt-2 flex items-center gap-1"><Truck size={11} /> Preferred: {order.preferredCarrier}</p>
            )}
          </div>
          <div className="bg-white rounded-lg border border-outline-variant/20 p-5">
            <h3 className="font-headline font-black text-xs uppercase tracking-wider mb-3 flex items-center gap-2"><CreditCard size={13} /> Payment</h3>
            <p className="text-sm text-on-surface capitalize">{order.paymentMethod}</p>
            <span className={`badge mt-1 ${order.paymentStatus === 'paid' ? 'badge-success' : order.paymentStatus === 'failed' ? 'badge-error' : 'badge-warning'}`}>{order.paymentStatus}</span>
            {order.paidAt && <p className="text-xs text-outline mt-1">Paid: {new Date(order.paidAt).toLocaleDateString()}</p>}
          </div>
        </div>

        {/* Price breakdown */}
        <div className="bg-white rounded-lg border border-outline-variant/20 p-5 space-y-2 text-sm">
          <h3 className="font-headline font-black text-xs uppercase tracking-wider mb-3">Price Breakdown</h3>
          <div className="flex justify-between text-on-surface-variant"><span>Subtotal</span><span>${order.subtotal.toFixed(2)}</span></div>
          {order.discountAmount > 0 && <div className="flex justify-between text-success"><span>Discount</span><span>-${order.discountAmount.toFixed(2)}</span></div>}
          <div className="flex justify-between text-on-surface-variant"><span>Shipping</span><span>{order.shippingCost === 0 ? 'Free' : `$${order.shippingCost.toFixed(2)}`}</span></div>
          <div className="flex justify-between text-on-surface-variant"><span>Tax</span><span>${order.taxAmount.toFixed(2)}</span></div>
          <div className="flex justify-between font-bold text-on-surface text-base border-t border-outline-variant/10 pt-2"><span>Total</span><span>${order.totalPrice.toFixed(2)}</span></div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          {order.status === 'delivered' && (
            <button onClick={handleReturn} disabled={returning} className="btn-secondary text-xs">
              {returning ? <div className="w-4 h-4 border-2 border-primary-900 border-t-transparent rounded-full animate-spin" /> : <><RotateCcw size={13} /> Request Return</>}
            </button>
          )}
          <Link to="/products" className="btn-ghost text-xs">Continue Shopping</Link>
        </div>
      </div>
    </>
  );
};

export default OrderDetailPage;
