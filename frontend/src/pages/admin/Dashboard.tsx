import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  Users, Package, ShoppingCart, DollarSign,
  TrendingUp, AlertCircle, ArrowUpRight, ArrowDownRight,
  Clock, CheckCircle, XCircle, Truck
} from 'lucide-react';
import api from '@/api/axios';
import { DashboardStats, Order } from '@/types';
import { Helmet } from 'react-helmet-async';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f57f17', confirmed: '#1A237E', processing: '#0288d1',
  shipped: '#6a1b9a', delivered: '#2e7d32', cancelled: '#c62828',
  return_requested: '#ef6c00', returned: '#4e342e',
};

const CHART_COLORS = ['#1A237E', '#283593', '#3949AB', '#5C6BC0', '#7986CB', '#9FA8DA'];

const StatCard = ({ icon: Icon, label, value, change, color, to }: any) => (
  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-6">
    <div className="flex items-start justify-between">
      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${change >= 0 ? 'text-success' : 'text-error'}`}>
          {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {Math.abs(change).toFixed(1)}%
        </div>
      )}
    </div>
    <div className="mt-4">
      <p className="text-2xl font-headline font-black text-on-surface">{value}</p>
      <p className="text-xs text-outline uppercase tracking-widest mt-1">{label}</p>
    </div>
    {to && <Link to={to} className="text-xs text-primary-700 font-semibold mt-3 block hover:text-primary-900">View all →</Link>}
  </motion.div>
);

const AdminDashboard = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/dashboard')
      .then(({ data }) => setStats(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 skeleton rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-64 skeleton rounded-lg" />
          <div className="h-64 skeleton rounded-lg" />
        </div>
      </div>
    );
  }

  if (!stats) return <div className="text-center py-20 text-outline">Failed to load dashboard</div>;

  const orderStatusData = stats.orders.byStatus.map((s) => ({
    name: s._id,
    value: s.count,
    color: STATUS_COLORS[s._id] || '#767683',
  }));

  // Mock revenue chart data (last 6 months)
  const revenueChartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return {
      month: d.toLocaleString('default', { month: 'short' }),
      revenue: Math.round(Math.random() * 50000 + 10000),
      orders: Math.round(Math.random() * 200 + 50),
    };
  });

  return (
    <>
      <Helmet><title>Dashboard | Admin — CartLy</title></Helmet>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="font-headline text-2xl font-black tracking-tighter text-on-surface">Dashboard</h1>
          <p className="text-sm text-outline mt-1">Welcome back. Here's what's happening.</p>
        </div>

        {/* Pending alerts */}
        {stats.sellers.pendingApprovals > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3"
          >
            <AlertCircle size={16} className="text-warning flex-shrink-0" />
            <p className="text-sm text-yellow-800">
              <strong>{stats.sellers.pendingApprovals}</strong> seller application{stats.sellers.pendingApprovals > 1 ? 's' : ''} awaiting approval.{' '}
              <Link to="/admin/users?role=seller" className="font-bold underline">Review now →</Link>
            </p>
          </motion.div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Total Users"
            value={stats.users.total.toLocaleString()}
            change={stats.users.newThisMonth > 0 ? 12.5 : 0}
            color="bg-blue-600"
            to="/admin/users"
          />
          <StatCard
            icon={Package}
            label="Products"
            value={stats.products.active.toLocaleString()}
            color="bg-purple-600"
            to="/admin/products"
          />
          <StatCard
            icon={ShoppingCart}
            label="Orders This Month"
            value={stats.orders.thisMonth.toLocaleString()}
            change={8.3}
            color="bg-primary-900"
            to="/admin/orders"
          />
          <StatCard
            icon={DollarSign}
            label="Revenue (Month)"
            value={`$${stats.revenue.thisMonth.toLocaleString()}`}
            change={stats.revenue.growth}
            color="bg-green-600"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Chart */}
          <div className="lg:col-span-2 card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-headline font-black text-on-surface">Revenue Overview</h3>
                <p className="text-xs text-outline mt-0.5">Last 6 months</p>
              </div>
              <div className="flex items-center gap-1 text-xs font-semibold text-success">
                <TrendingUp size={13} />
                +{Math.abs(stats.revenue.growth).toFixed(1)}% vs last month
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenueChartData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1A237E" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1A237E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ea" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#767683' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#767683' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']}
                  contentStyle={{ fontSize: 12, borderRadius: 4, border: '1px solid #e8e8ea' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#1A237E" strokeWidth={2} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Order Status Pie */}
          <div className="card p-6">
            <h3 className="font-headline font-black text-on-surface mb-1">Orders by Status</h3>
            <p className="text-xs text-outline mb-4">Total: {stats.orders.total.toLocaleString()}</p>
            {orderStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={orderStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {orderStatusData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, name: string) => [v, name]} contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-outline text-sm">No order data</div>
            )}
            <div className="space-y-2 mt-2">
              {orderStatusData.slice(0, 5).map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-on-surface-variant capitalize">{s.name.replace(/_/g, ' ')}</span>
                  </div>
                  <span className="font-semibold text-on-surface">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Orders */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h3 className="font-headline font-black text-sm text-on-surface">Recent Orders</h3>
              <Link to="/admin/orders" className="text-xs text-primary-700 font-semibold hover:text-primary-900">View all →</Link>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {stats.recentOrders.slice(0, 5).map((order) => (
                <div key={order._id} className="flex items-center gap-3 px-6 py-3">
                  <div className="w-8 h-8 rounded-full editorial-gradient flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">
                      {(order.user as any)?.name?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-on-surface">{order.orderNumber}</p>
                    <p className="text-xs text-outline">{(order.user as any)?.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-on-surface">${order.totalPrice.toFixed(2)}</p>
                    <span className={`badge text-[10px] ${
                      order.status === 'delivered' ? 'badge-success' :
                      order.status === 'cancelled' ? 'badge-error' :
                      'badge-warning'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Products */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h3 className="font-headline font-black text-sm text-on-surface">Top Selling Products</h3>
              <Link to="/admin/products" className="text-xs text-primary-700 font-semibold hover:text-primary-900">View all →</Link>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {stats.topSellingProducts.slice(0, 5).map((product, i) => (
                <div key={product._id} className="flex items-center gap-3 px-6 py-3">
                  <span className="text-xs font-black text-outline w-4">{i + 1}</span>
                  <img
                    src={product.images?.[0]?.url || '/placeholder.jpg'}
                    alt={product.name}
                    className="w-8 h-8 rounded-sm object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-on-surface truncate">{product.name}</p>
                    <p className="text-xs text-outline">{product.sales} sold</p>
                  </div>
                  <span className="text-xs font-bold text-on-surface">${product.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Category Distribution */}
        {stats.categoryStats?.length > 0 && (
          <div className="card p-6">
            <h3 className="font-headline font-black text-on-surface mb-4">Products by Category</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {stats.categoryStats.map((cat, i) => (
                <div key={cat.name} className="text-center p-3 rounded-md bg-surface-low">
                  <div
                    className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  >
                    {cat.name[0]}
                  </div>
                  <p className="text-xs font-semibold text-on-surface truncate">{cat.name}</p>
                  <p className="text-xs text-outline">{cat.productCount}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AdminDashboard;
