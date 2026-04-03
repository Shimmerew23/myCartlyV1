import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Truck } from 'lucide-react';
import api from '@/api/axios';
import { Carrier } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const EMPTY_FORM = { name: '', code: '', trackingUrlTemplate: '', logoUrl: '', sortOrder: 0 };

const AdminCarriers = () => {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/carriers');
      setCarriers(data.data);
    } catch { toast.error('Failed to load carriers'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (c: Carrier) => {
    setEditing(c);
    setForm({ name: c.name, code: c.code, trackingUrlTemplate: c.trackingUrlTemplate || '', logoUrl: c.logoUrl || '', sortOrder: c.sortOrder });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error('Name and code are required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/admin/carriers/${editing._id}`, form);
        toast.success('Carrier updated');
      } else {
        await api.post('/admin/carriers', form);
        toast.success('Carrier created');
      }
      setShowModal(false);
      load();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Save failed'); }
    setSaving(false);
  };

  const handleToggle = async (c: Carrier) => {
    try {
      await api.put(`/admin/carriers/${c._id}`, { isActive: !c.isActive });
      toast.success(c.isActive ? 'Carrier disabled' : 'Carrier enabled');
      load();
    } catch { toast.error('Update failed'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this carrier? Orders that referenced it will retain the carrier name.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/admin/carriers/${id}`);
      toast.success('Carrier deleted');
      load();
    } catch { toast.error('Delete failed'); } finally { setDeletingId(null); }
  };

  return (
    <>
      <Helmet><title>Carriers | Admin</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">Carriers</h1>
            <p className="text-sm text-outline mt-0.5">Manage shipping carriers available at checkout</p>
          </div>
          <button onClick={openAdd} className="btn-primary text-xs flex items-center gap-2"><Plus size={14} /> Add Carrier</button>
        </div>

        <div className="card overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Code</th>
                <th>Tracking URL Template</th>
                <th>Sort</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-24" /></td>)}</tr>
                ))
              ) : carriers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <Truck size={32} className="text-outline mx-auto mb-3" />
                    <p className="text-outline text-sm">No carriers yet. Add one to let buyers choose at checkout.</p>
                  </td>
                </tr>
              ) : carriers.map((c) => (
                <tr key={c._id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {c.logoUrl
                        ? <img src={c.logoUrl} alt={c.name} className="w-8 h-8 object-contain rounded" />
                        : <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-xs font-bold text-outline">{c.name[0]}</div>
                      }
                      <span className="font-semibold text-sm">{c.name}</span>
                    </div>
                  </td>
                  <td><code className="text-xs bg-surface-container px-2 py-0.5 rounded">{c.code}</code></td>
                  <td>
                    <span className="text-xs text-outline truncate max-w-[200px] block">
                      {c.trackingUrlTemplate || <em className="not-italic text-outline/50">Not set</em>}
                    </span>
                  </td>
                  <td><span className="text-sm">{c.sortOrder}</span></td>
                  <td>
                    <button onClick={() => handleToggle(c)} className={`flex items-center gap-1 text-xs font-semibold ${c.isActive ? 'text-success' : 'text-outline'}`}>
                      {c.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      {c.isActive ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(c)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container transition-colors text-outline hover:text-on-surface">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(c._id)} disabled={deletingId === c._id} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 transition-colors text-outline hover:text-error disabled:opacity-40">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="font-headline font-black text-lg">{editing ? 'Edit Carrier' : 'Add Carrier'}</h2>
            <div className="space-y-3">
              <div>
                <label className="label-sm block mb-1.5">Name <span className="text-error">*</span></label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-box text-sm w-full" placeholder="e.g. FedEx" />
              </div>
              <div>
                <label className="label-sm block mb-1.5">Code <span className="text-error">*</span></label>
                <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))} className="input-box text-sm w-full" placeholder="e.g. fedex" disabled={!!editing} />
                {editing && <p className="text-xs text-outline mt-0.5">Code cannot be changed after creation</p>}
              </div>
              <div>
                <label className="label-sm block mb-1.5">Tracking URL Template</label>
                <input value={form.trackingUrlTemplate} onChange={(e) => setForm((f) => ({ ...f, trackingUrlTemplate: e.target.value }))} className="input-box text-sm w-full" placeholder="https://example.com/track?n={trackingNumber}" />
                <p className="text-xs text-outline mt-0.5">Use <code className="bg-surface-container px-1 rounded">{'{trackingNumber}'}</code> as placeholder</p>
              </div>
              <div>
                <label className="label-sm block mb-1.5">Logo URL (optional)</label>
                <input value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} className="input-box text-sm w-full" placeholder="https://..." />
              </div>
              <div>
                <label className="label-sm block mb-1.5">Sort Order</label>
                <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} className="input-box text-sm w-24" min={0} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (editing ? 'Save Changes' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminCarriers;
