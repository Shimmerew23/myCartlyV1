import { useEffect, useState } from 'react';
import { Package, ChevronDown, RefreshCw, Truck } from 'lucide-react';
import api from '@/api/axios';
import { Order, Carrier } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import { useOrderStatusUpdate, fetchActiveCarriers } from '@/hooks/useOrderStatusUpdate';

const STATUS_STYLES: Record<string, string> = { pending:'badge-warning',confirmed:'badge-info',processing:'badge-info',shipped:'badge-primary',out_for_delivery:'badge-primary',delivered:'badge-success',cancelled:'badge-error' };
const NEXT_STATUS: Record<string, string[]> = { pending:['confirmed','cancelled'],confirmed:['processing','cancelled'],processing:['shipped'],shipped:['out_for_delivery','delivered'] };

interface ShipDialog { orderId: string; preferredCarrier?: string }

const SellerOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [shipDialog, setShipDialog] = useState<ShipDialog | null>(null);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [shipForm, setShipForm] = useState({ carrierId: '', trackingNumber: '' });
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const fetchOrders = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get('/orders/seller-orders', { params: { page, status: statusFilter || undefined } });
      setOrders(data.data); setPagination(data.pagination);
    } catch { toast.error('Failed to load orders'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchOrders(1); }, [statusFilter]);

  const { updateStatus, updatingId } = useOrderStatusUpdate(() => fetchOrders(pagination.page));

  const handleStatusChange = async (order: Order, status: string) => {
    if (status === 'shipped') {
      const activeCarriers = await fetchActiveCarriers();
      setCarriers(activeCarriers);
      setShipForm({ carrierId: '', trackingNumber: '' });
      setShipDialog({ orderId: order._id, preferredCarrier: order.preferredCarrier });
      setPendingOrderId(order._id);
    } else {
      await updateStatus(order._id, status);
    }
  };

  const confirmShip = async () => {
    if (!pendingOrderId || !shipForm.trackingNumber.trim()) {
      toast.error('Tracking number is required');
      return;
    }
    await updateStatus(pendingOrderId, 'shipped', {
      shipPayload: { carrierId: shipForm.carrierId, trackingNumber: shipForm.trackingNumber },
    });
    setShipDialog(null);
    setPendingOrderId(null);
  };

  return (
    <>
      <Helmet><title>My Orders | Seller</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="font-headline text-2xl font-black tracking-tighter">Orders</h1><p className="text-sm text-outline mt-0.5">{pagination.total} orders</p></div>
          <div className="flex items-center gap-3">
            <div className="relative"><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer"><option value="">All Status</option>{['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'].map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select><ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" /></div>
            <button onClick={() => fetchOrders(1)} className="btn-ghost text-xs"><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="table-base">
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th><th>Update</th></tr></thead>
            <tbody>
              {loading ? [...Array(6)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>)
                : orders.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-16"><Package size={32} className="text-outline mx-auto mb-3" /><p className="text-outline">No orders yet</p></td></tr>
                ) : orders.map((order) => (
                <tr key={order._id}>
                  <td>
                    <p className="font-semibold text-xs">{order.orderNumber}</p>
                    {order.preferredCarrier && <p className="text-[10px] text-outline mt-0.5">Wants: {order.preferredCarrier}</p>}
                  </td>
                  <td><p className="text-xs font-medium">{(order.user as any)?.name || '—'}</p></td>
                  <td>
                    <div className="flex gap-1">
                      {order.items.slice(0, 3).map((item, i) => <img key={i} src={item.image || '/placeholder.jpg'} alt={item.name} className="w-7 h-7 rounded-sm object-cover" />)}
                      {order.items.length > 3 && <span className="w-7 h-7 rounded-sm bg-surface-container text-xs font-bold flex items-center justify-center text-outline">+{order.items.length - 3}</span>}
                    </div>
                  </td>
                  <td><span className="font-bold text-sm">${order.totalPrice.toFixed(2)}</span></td>
                  <td><span className={`badge ${STATUS_STYLES[order.status] || 'badge-neutral'}`}>{order.status.replace(/_/g,' ')}</span></td>
                  <td><span className="text-xs text-outline">{new Date(order.createdAt).toLocaleDateString()}</span></td>
                  <td>
                    {NEXT_STATUS[order.status]?.length > 0 ? (
                      <div className="relative">
                        <select
                          onChange={(e) => { if (e.target.value) handleStatusChange(order, e.target.value); e.currentTarget.value = ''; }}
                          disabled={updatingId === order._id}
                          defaultValue=""
                          className="appearance-none pl-2 pr-6 py-1 text-xs bg-surface-low border border-outline-variant/30 rounded-md cursor-pointer focus:outline-none"
                        >
                          <option value="" disabled>Update →</option>
                          {NEXT_STATUS[order.status]?.map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                        </select>
                        <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
                      </div>
                    ) : <span className="text-xs text-outline">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination.pages > 1 && (
            <div className="flex justify-between items-center px-6 py-3 border-t border-outline-variant/10">
              <p className="text-xs text-outline">Page {pagination.page} of {pagination.pages}</p>
              <div className="flex gap-1"><button onClick={() => fetchOrders(pagination.page - 1)} disabled={pagination.page <= 1} className="btn-ghost text-xs disabled:opacity-40">← Prev</button><button onClick={() => fetchOrders(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn-ghost text-xs disabled:opacity-40">Next →</button></div>
            </div>
          )}
        </div>
      </div>

      {/* Ship Order Dialog */}
      {shipDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Truck size={18} className="text-primary-900" />
              <h2 className="font-headline font-black text-lg">Mark as Shipped</h2>
            </div>
            {shipDialog.preferredCarrier && (
              <p className="text-xs bg-primary-50 text-primary-700 px-3 py-2 rounded-md">
                Buyer requested: <strong>{shipDialog.preferredCarrier}</strong>
              </p>
            )}
            <div className="space-y-3">
              <div>
                <label className="label-sm block mb-1.5">Carrier</label>
                <select value={shipForm.carrierId} onChange={(e) => setShipForm((f) => ({ ...f, carrierId: e.target.value }))} className="input-box text-sm w-full">
                  <option value="">Select carrier…</option>
                  {carriers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label-sm block mb-1.5">Tracking Number <span className="text-error">*</span></label>
                <input value={shipForm.trackingNumber} onChange={(e) => setShipForm((f) => ({ ...f, trackingNumber: e.target.value }))} className="input-box text-sm w-full" placeholder="e.g. 1Z999AA10123456784" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShipDialog(null); setPendingOrderId(null); }} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button onClick={confirmShip} disabled={!!updatingId} className="btn-primary flex-1 justify-center">
                {updatingId ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Confirm Ship'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SellerOrders;
