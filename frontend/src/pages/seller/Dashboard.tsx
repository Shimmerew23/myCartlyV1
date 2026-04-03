// seller/Dashboard.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, ShoppingCart, DollarSign, Eye, Plus, TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '@/api/axios';
import { useAppSelector } from '@/store';
import { Helmet } from 'react-helmet-async';

const SellerDashboard = () => {
  const { user } = useAppSelector((s) => s.auth);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/products/seller-stats')
      .then(({ data }) => setStats(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Active Products', value: stats?.productStats?.find((s: any) => s._id === 'active')?.count || 0, icon: Package, color: 'bg-blue-600', to: '/seller/products' },
    { label: 'Total Sales', value: stats?.revenueStats?.[0]?.totalSales || 0, icon: ShoppingCart, color: 'bg-purple-600', to: '/seller/orders' },
    { label: 'Revenue', value: `$${(stats?.revenueStats?.[0]?.totalRevenue || 0).toFixed(2)}`, icon: DollarSign, color: 'bg-green-600' },
    { label: 'Total Views', value: (stats?.revenueStats?.[0]?.totalViews || 0).toLocaleString(), icon: Eye, color: 'bg-orange-500' },
  ];

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return { month: d.toLocaleString('default', { month: 'short' }), sales: Math.round(Math.random() * 50 + 5) };
  });

  return (
    <>
      <Helmet><title>Seller Dashboard | CartLy</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">Seller Dashboard</h1>
            <p className="text-sm text-outline mt-0.5">
              {user?.sellerProfile?.storeName || user?.name}'s store
              {!user?.sellerProfile?.isApproved && (
                <span className="ml-2 badge badge-warning">Pending Approval</span>
              )}
            </p>
          </div>
          <Link to="/seller/products/new" className="btn-primary text-xs">
            <Plus size={14} /> Add Product
          </Link>
        </div>

        {!user?.sellerProfile?.isApproved && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-5 py-4">
            <p className="text-sm text-yellow-800 font-medium">⏳ Your seller account is pending admin approval. You can set up your products, but they won't be visible until approved.</p>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div key={card.label} className="card p-5">
              <div className={`w-9 h-9 rounded-md ${card.color} flex items-center justify-center mb-3`}>
                <card.icon size={16} className="text-white" />
              </div>
              <p className="text-xl font-headline font-black text-on-surface">{card.value}</p>
              <p className="text-xs text-outline uppercase tracking-widest mt-0.5">{card.label}</p>
              {card.to && <Link to={card.to} className="text-xs text-primary-700 font-semibold mt-2 block">View →</Link>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <h3 className="font-headline font-black text-on-surface mb-4 flex items-center gap-2">
              <TrendingUp size={16} /> Sales This Year
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1A237E" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1A237E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ea" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#767683' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#767683' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4 }} />
                <Area type="monotone" dataKey="sales" stroke="#1A237E" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-6">
            <h3 className="font-headline font-black text-on-surface mb-4">Top Products</h3>
            <div className="space-y-3">
              {stats?.topProducts?.length > 0 ? stats.topProducts.map((p: any, i: number) => (
                <div key={p._id} className="flex items-center gap-3">
                  <span className="text-xs font-black text-outline w-4">{i + 1}</span>
                  <img src={p.images?.[0]?.url || '/placeholder.jpg'} alt={p.name} className="w-8 h-8 rounded-sm object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-on-surface truncate">{p.name}</p>
                    <p className="text-xs text-outline">{p.sales} sold</p>
                  </div>
                  <span className="text-xs font-bold">${p.price.toFixed(2)}</span>
                </div>
              )) : (
                <p className="text-sm text-outline text-center py-8">No products yet. <Link to="/seller/products/new" className="text-primary-700 font-semibold">Add one →</Link></p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SellerDashboard;
