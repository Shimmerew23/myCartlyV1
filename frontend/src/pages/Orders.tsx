import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, ChevronRight, Search } from 'lucide-react';
import api from '@/api/axios';
import { Order } from '@/types';
import { Helmet } from 'react-helmet-async';

const STATUS_STYLES: Record<string, string> = {
  pending: 'badge-warning', confirmed: 'badge-info', processing: 'badge-info',
  shipped: 'badge-primary', out_for_delivery: 'badge-primary', delivered: 'badge-success',
  cancelled: 'badge-error', return_requested: 'badge-warning', returned: 'badge-neutral', refunded: 'badge-neutral',
};

const STATUS_LABEL: Record<string, string> = {
  shipped: 'In Transit',
  out_for_delivery: 'Out for Delivery',
};

const OrdersPage = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetch = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get('/orders/my-orders', { params: { page, status: statusFilter || undefined } });
      setOrders(data.data); setPagination(data.pagination);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetch(1); }, [statusFilter]);

  return (
    <>
      <Helmet><title>My Orders | CartLy</title></Helmet>
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="font-headline text-3xl font-black tracking-tighter">My Orders</h1><p className="text-sm text-outline mt-0.5">{pagination.total} orders</p></div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-box text-sm w-40">
            <option value="">All Status</option>
            {['pending','confirmed','processing','shipped','delivered','cancelled','returned'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-28 skeleton rounded-lg" />)}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <Package size={48} className="text-outline mx-auto mb-4" />
            <h2 className="font-headline text-xl font-black mb-2">No orders yet</h2>
            <p className="text-outline mb-6">When you place an order, it will appear here</p>
            <Link to="/products" className="btn-primary">Start Shopping</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <Link key={order._id} to={`/orders/${order._id}`} className="block bg-white rounded-lg border border-outline-variant/20 p-5 hover:shadow-editorial transition-shadow group">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-headline font-black text-sm text-on-surface">{order.orderNumber}</p>
                    <p className="text-xs text-outline mt-0.5">{new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${STATUS_STYLES[order.status] || 'badge-neutral'}`}>{STATUS_LABEL[order.status] ?? order.status.replace(/_/g, ' ')}</span>
                    <span className="font-bold text-on-surface">${order.totalPrice.toFixed(2)}</span>
                    <ChevronRight size={15} className="text-outline group-hover:text-primary-900 transition-colors" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {order.items.slice(0, 4).map((item, i) => (
                    <div key={i} className="w-10 h-10 rounded-md overflow-hidden bg-surface-low border border-outline-variant/10 flex-shrink-0">
                      <img src={item.image || '/placeholder.jpg'} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {order.items.length > 4 && <div className="w-10 h-10 rounded-md bg-surface-container flex items-center justify-center text-xs font-bold text-outline">+{order.items.length - 4}</div>}
                  <div className="ml-2 flex-1">
                    <p className="text-xs text-on-surface line-clamp-1">{order.items.map((i) => i.name).join(', ')}</p>
                    <p className="text-xs text-outline">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {pagination.pages > 1 && (
          <div className="flex justify-center gap-2">
            <button onClick={() => fetch(pagination.page - 1)} disabled={pagination.page <= 1} className="btn-ghost text-xs disabled:opacity-40">← Prev</button>
            <span className="px-3 py-2 text-xs text-outline">Page {pagination.page} of {pagination.pages}</span>
            <button onClick={() => fetch(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn-ghost text-xs disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </>
  );
};

export default OrdersPage;
