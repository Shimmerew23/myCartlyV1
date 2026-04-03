// Seller Products page
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Eye, Search, Package } from 'lucide-react';
import api from '@/api/axios';
import { Product } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const SellerProducts = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const fetch = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get('/products/my-products', { params: { page, search, status } });
      setProducts(data.data);
      setPagination(data.pagination);
    } catch { toast.error('Failed to load products'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(1); }, [search, status]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success('Product deleted');
      fetch(1);
    } catch { toast.error('Delete failed'); }
  };

  const STATUS_COLORS: Record<string, string> = {
    active: 'badge-success', draft: 'badge-neutral', inactive: 'badge-warning',
    archived: 'badge-error', suspended: 'badge-error',
  };

  return (
    <>
      <Helmet><title>My Products | Seller</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">My Products</h1>
            <p className="text-sm text-outline mt-0.5">{pagination.total} products</p>
          </div>
          <Link to="/seller/products/new" className="btn-primary text-xs"><Plus size={14} /> Add Product</Link>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="w-full pl-9 pr-3 py-2 text-sm input-box" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-box text-sm w-32">
            <option value="">All Status</option>
            {['active', 'draft', 'inactive', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="card overflow-hidden">
          <table className="table-base">
            <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Sales</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? [...Array(6)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>) :
                products.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-16">
                    <Package size={32} className="text-outline mx-auto mb-3" />
                    <p className="text-outline">No products yet. <Link to="/seller/products/new" className="text-primary-700 font-semibold">Add your first →</Link></p>
                  </td></tr>
                ) : products.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <img src={p.images?.[0]?.url || '/placeholder.jpg'} alt={p.name} className="w-10 h-10 rounded-sm object-cover" />
                        <div>
                          <p className="text-sm font-semibold text-on-surface line-clamp-1">{p.name}</p>
                          <p className="text-xs text-outline">{p.sku || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td><span className="font-semibold">${p.price.toFixed(2)}</span></td>
                    <td>
                      <span className={p.stock <= 5 ? 'text-error font-semibold' : 'text-on-surface'}>{p.stock}</span>
                      {p.stock <= 5 && p.stock > 0 && <span className="badge badge-warning text-[9px] ml-1">Low</span>}
                      {p.stock === 0 && <span className="badge badge-error text-[9px] ml-1">Out</span>}
                    </td>
                    <td><span className={`badge ${STATUS_COLORS[p.status] || 'badge-neutral'}`}>{p.status}</span></td>
                    <td><span className="text-sm">{p.sales}</span></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Link to={`/products/${p.slug}`} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container transition-colors text-outline hover:text-on-surface"><Eye size={13} /></Link>
                        <Link to={`/seller/products/${p._id}/edit`} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container transition-colors text-outline hover:text-on-surface"><Edit2 size={13} /></Link>
                        <button onClick={() => handleDelete(p._id, p.name)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 transition-colors text-outline hover:text-error"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          {pagination.pages > 1 && (
            <div className="flex justify-between items-center px-6 py-3 border-t border-outline-variant/10">
              <p className="text-xs text-outline">Page {pagination.page} of {pagination.pages}</p>
              <div className="flex gap-1">
                <button onClick={() => fetch(pagination.page - 1)} disabled={pagination.page <= 1} className="btn-ghost text-xs disabled:opacity-40">← Prev</button>
                <button onClick={() => fetch(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn-ghost text-xs disabled:opacity-40">Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SellerProducts;
