import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronDown, RefreshCw, Eye, Edit2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/api/axios';
import { Product } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const STATUS_STYLES: Record<string, string> = { active:'badge-success',draft:'badge-neutral',inactive:'badge-warning',suspended:'badge-error',archived:'badge-error' };

const AdminProducts = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', sort: '-createdAt' });

  const fetch = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20, ...filters };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data } = await api.get('/admin/products', { params });
      setProducts(data.data); setPagination(data.pagination);
    } catch { toast.error('Failed'); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetch(1); }, [filters]);

  const toggleStatus = async (product: Product) => {
    const newStatus = product.status === 'active' ? 'suspended' : 'active';
    try { await api.put(`/admin/products/${product._id}`, { status: newStatus }); toast.success(`Product ${newStatus}`); fetch(pagination.page); } catch { toast.error('Failed'); }
  };

  return (
    <>
      <Helmet><title>Products | Admin</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between"><div><h1 className="font-headline text-2xl font-black tracking-tighter">All Products</h1><p className="text-sm text-outline mt-0.5">{pagination.total.toLocaleString()} total</p></div><button onClick={() => fetch(1)} className="btn-ghost text-xs"><RefreshCw size={14} /> Refresh</button></div>
        <div className="card p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" /><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search products..." className="w-full pl-9 pr-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant" /></div>
          {[{ key: 'status', opts: [['','All Status'],['active','Active'],['draft','Draft'],['inactive','Inactive'],['suspended','Suspended']] }, { key: 'sort', opts: [['-createdAt','Newest'],['-sales','Best Selling'],['-price','Highest Price'],['price','Lowest Price']] }].map(({ key, opts }) => (
            <div key={key} className="relative"><select value={(filters as any)[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" /></div>
          ))}
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Stock</th><th>Sales</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? [...Array(8)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>)
                  : products.length === 0 ? <tr><td colSpan={8} className="text-center py-12 text-outline">No products found</td></tr>
                  : products.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <img src={p.images?.[0]?.url || '/placeholder.jpg'} alt={p.name} className="w-9 h-9 rounded-sm object-cover flex-shrink-0" />
                        <div><p className="text-sm font-semibold text-on-surface line-clamp-1 max-w-40">{p.name}</p><p className="text-xs text-outline">{p.sku || '—'}</p></div>
                      </div>
                    </td>
                    <td><p className="text-xs">{(p.seller as any)?.sellerProfile?.storeName || (p.seller as any)?.name}</p></td>
                    <td><p className="text-xs">{(p.category as any)?.name || '—'}</p></td>
                    <td><span className="font-semibold text-sm">${p.price.toFixed(2)}</span></td>
                    <td><span className={`text-sm ${p.stock <= 5 ? 'text-error font-semibold' : ''}`}>{p.stock}</span></td>
                    <td><span className="text-sm">{p.sales}</span></td>
                    <td><span className={`badge ${STATUS_STYLES[p.status] || 'badge-neutral'}`}>{p.status}</span></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Link to={`/products/${p.slug}`} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-outline hover:text-on-surface transition-colors"><Eye size={13} /></Link>
                        <button onClick={() => toggleStatus(p)} title={p.status === 'active' ? 'Suspend' : 'Activate'} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-outline hover:text-on-surface transition-colors">
                          {p.status === 'active' ? <ToggleRight size={14} className="text-success" /> : <ToggleLeft size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination.pages > 1 && (
            <div className="flex justify-between items-center px-6 py-3 border-t border-outline-variant/10">
              <p className="text-xs text-outline">Page {pagination.page} of {pagination.pages}</p>
              <div className="flex gap-1"><button onClick={() => fetch(pagination.page - 1)} disabled={pagination.page <= 1} className="btn-ghost text-xs disabled:opacity-40">← Prev</button><button onClick={() => fetch(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn-ghost text-xs disabled:opacity-40">Next →</button></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AdminProducts;
