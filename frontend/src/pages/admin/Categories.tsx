import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react';
import api from '@/api/axios';
import { Category } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const AdminCategories = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', icon: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetch = async () => { setLoading(true); try { const { data } = await api.get('/categories'); setCategories(data.data); } catch {} finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editId) { await api.put(`/categories/${editId}`, form); toast.success('Category updated'); }
      else { await api.post('/categories', form); toast.success('Category created'); }
      setForm({ name: '', description: '', icon: '' }); setEditId(null); fetch();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); }
    setSaving(false);
  };

  const handleEdit = (cat: Category) => { setEditId(cat._id); setForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '' }); };
  const handleDelete = async (id: string) => { if (!window.confirm('Delete this category?')) return; try { await api.delete(`/categories/${id}`); toast.success('Deleted'); fetch(); } catch { toast.error('Failed'); } };

  return (
    <>
      <Helmet><title>Categories | Admin</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center justify-between"><h1 className="font-headline text-2xl font-black tracking-tighter">Categories</h1><button onClick={fetch} className="btn-ghost text-xs"><RefreshCw size={14} /> Refresh</button></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="card p-5">
              <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-4">{editId ? 'Edit Category' : 'New Category'}</h3>
              <form onSubmit={handleSave} className="space-y-3">
                <div><label className="label-sm block mb-1.5">Name *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required className="input-box text-sm" placeholder="e.g. Electronics" /></div>
                <div><label className="label-sm block mb-1.5">Icon (material symbol)</label><input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} className="input-box text-sm" placeholder="e.g. devices" /></div>
                <div><label className="label-sm block mb-1.5">Description</label><textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="input-box text-sm resize-none" /></div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center text-xs">{saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : editId ? 'Update' : <><Plus size={13} /> Create</>}</button>
                  {editId && <button type="button" onClick={() => { setEditId(null); setForm({ name: '', description: '', icon: '' }); }} className="btn-secondary text-xs px-3">Cancel</button>}
                </div>
              </form>
            </div>
          </div>
          <div className="lg:col-span-2 card overflow-hidden">
            <table className="table-base">
              <thead><tr><th>Category</th><th>Icon</th><th>Products</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>)
                  : categories.map((cat) => (
                  <tr key={cat._id}>
                    <td><p className="font-semibold text-sm">{cat.name}</p>{cat.description && <p className="text-xs text-outline truncate max-w-40">{cat.description}</p>}</td>
                    <td><span className="material-symbols-outlined text-base text-outline">{cat.icon || 'category'}</span></td>
                    <td><span className="text-sm">{cat.productCount || 0}</span></td>
                    <td><span className={`badge ${cat.isActive ? 'badge-success' : 'badge-neutral'}`}>{cat.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEdit(cat)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-outline hover:text-on-surface"><Edit2 size={13} /></button>
                        <button onClick={() => handleDelete(cat._id)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-outline hover:text-error"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminCategories;
