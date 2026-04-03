import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronDown, RefreshCw, Eye, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/api/axios';
import { Order, Carrier } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import { useOrderStatusUpdate, fetchActiveCarriers } from '@/hooks/useOrderStatusUpdate';

const STATUS_STYLES: Record<string, string> = { pending:'badge-warning',confirmed:'badge-info',processing:'badge-info',shipped:'badge-primary',out_for_delivery:'badge-primary',delivered:'badge-success',cancelled:'badge-error',return_requested:'badge-warning',returned:'badge-neutral',refunded:'badge-neutral' };
const PAYMENT_STYLES: Record<string, string> = { paid:'badge-success',pending:'badge-warning',failed:'badge-error',refunded:'badge-neutral' };

interface ShipDialog { orderId: string; preferredCarrier?: string }

const AdminOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', paymentStatus: '', sort: '-createdAt' });
  const [shipDialog, setShipDialog] = useState<ShipDialog | null>(null);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [shipForm, setShipForm] = useState({ carrierId: '', trackingNumber: '' });
  const [pendingStatus, setPendingStatus] = useState<{ orderId: string; status: string } | null>(null);

  const fetchOrders = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 20, ...filters };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data } = await api.get('/admin/orders', { params });
      setOrders(data.data); setPagination(data.pagination);
    } catch { toast.error('Failed to load orders'); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchOrders(1); }, [filters]);

  const { updateStatus, updatingId } = useOrderStatusUpdate(() => fetchOrders(pagination.page));

  const handleStatusChange = async (order: Order, status: string) => {
    if (status === 'shipped') {
      const activeCarriers = await fetchActiveCarriers();
      setCarriers(activeCarriers);
      setShipForm({ carrierId: '', trackingNumber: '' });
      setShipDialog({ orderId: order._id, preferredCarrier: order.preferredCarrier });
      setPendingStatus({ orderId: order._id, status });
    } else {
      await updateStatus(order._id, status);
    }
  };

  const confirmShip = async () => {
    if (!pendingStatus || !shipForm.trackingNumber.trim()) {
      toast.error('Tracking number is required');
      return;
    }
    await updateStatus(pendingStatus.orderId, 'shipped', {
      shipPayload: { carrierId: shipForm.carrierId, trackingNumber: shipForm.trackingNumber },
    });
    setShipDialog(null);
    setPendingStatus(null);
  };

  return (
    <>
      <Helmet><title>Orders | Admin</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="font-headline text-2xl font-black tracking-tighter">Orders</h1><p className="text-sm text-outline mt-0.5">{pagination.total.toLocaleString()} total</p></div>
          <button onClick={() => fetchOrders(1)} className="btn-ghost text-xs"><RefreshCw size={14} /> Refresh</button>
        </div>
        <div className="card p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" /><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search order number..." className="w-full pl-9 pr-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant" /></div>
          {[{ key: 'status', options: [['','All Status'],['pending','Pending'],['confirmed','Confirmed'],['processing','Processing'],['shipped','Shipped'],['out_for_delivery','Out for Delivery'],['delivered','Delivered'],['cancelled','Cancelled']] }, { key: 'paymentStatus', options: [['','All Payment'],['paid','Paid'],['pending','Pending'],['failed','Failed']] }, { key: 'sort', options: [['-createdAt','Newest'],['-totalPrice','Highest'],['totalPrice','Lowest']] }].map(({ key, options }) => (
            <div key={key} className="relative">
              <select value={(filters as any)[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
            </div>
          ))}
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>)
                  : orders.length === 0 ? <tr><td colSpan={8} className="text-center py-12 text-outline">No orders found</td></tr>
                  : orders.map((order) => (
                  <tr key={order._id}>
                    <td>
                      <p className="font-semibold text-xs">{order.orderNumber}</p>
                      {order.preferredCarrier && <p className="text-[10px] text-outline mt-0.5">Wants: {order.preferredCarrier}</p>}
                    </td>
                    <td><p className="text-xs font-medium">{(order.user as any)?.name}</p><p className="text-xs text-outline">{(order.user as any)?.email}</p></td>
                    <td><span className="text-sm">{order.items.length}</span></td>
                    <td><span className="font-bold text-sm">${order.totalPrice.toFixed(2)}</span></td>
                    <td><span className={`badge ${PAYMENT_STYLES[order.paymentStatus] || 'badge-neutral'}`}>{order.paymentStatus}</span></td>
                    <td>
                      <select
                        value={order.status}
                        onChange={(e) => handleStatusChange(order, e.target.value)}
                        disabled={updatingId === order._id}
                        className={`badge cursor-pointer border-0 appearance-none font-semibold text-xs ${STATUS_STYLES[order.status] || 'badge-neutral'} pr-4`}
                      >
                        {['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'].map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                      </select>
                    </td>
                    <td><span className="text-xs text-outline">{new Date(order.createdAt).toLocaleDateString()}</span></td>
                    <td>
                      <Link to={`/orders/${order._id}`} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container transition-colors text-outline hover:text-on-surface"><Eye size={13} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <button onClick={() => { setShipDialog(null); setPendingStatus(null); }} className="btn-secondary flex-1 justify-center">Cancel</button>
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

export default AdminOrders;
