import { useEffect, useState } from 'react';
import { Plus, Trash2, Ticket, RefreshCw } from 'lucide-react';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

interface Coupon { _id: string; code: string; discountType: string; discountValue: number; minimumOrderAmount: number; usageCount: number; usageLimit?: number; validFrom: string; validUntil: string; isActive: boolean; }

const AdminCoupons = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', discountType: 'percentage', discountValue: 10, minimumOrderAmount: 0, usageLimit: '', validFrom: new Date().toISOString().slice(0, 10), validUntil: '' });

  const fetch = async () => { setLoading(true); try { const { data } = await api.get('/admin/coupons'); setCoupons(data.data); } catch {} finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, code: form.code.toUpperCase(), usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined };
      await api.post('/admin/coupons', payload); toast.success('Coupon created!'); setForm({ code: '', discountType: 'percentage', discountValue: 10, minimumOrderAmount: 0, usageLimit: '', validFrom: new Date().toISOString().slice(0, 10), validUntil: '' }); fetch();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); }
    setSaving(false);
  };

  const handleDelete = async (id: string, code: string) => {
    if (!window.confirm(`Delete coupon "${code}"?`)) return;
    try { await api.delete(`/admin/coupons/${id}`); toast.success('Deleted'); fetch(); } catch { toast.error('Failed'); }
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  return (
    <>
      <Helmet><title>Coupons | Admin</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center justify-between"><h1 className="font-headline text-2xl font-black tracking-tighter">Coupons</h1><button onClick={fetch} className="btn-ghost text-xs"><RefreshCw size={14} /> Refresh</button></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="card p-5">
              <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-4 flex items-center gap-2"><Ticket size={14} /> Create Coupon</h3>
              <form onSubmit={handleCreate} className="space-y-3">
                <div><label className="label-sm block mb-1.5">Coupon Code *</label><input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required className="input-box text-sm uppercase font-mono" placeholder="SUMMER25" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label-sm block mb-1.5">Type</label><select value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))} className="input-box text-sm"><option value="percentage">%</option><option value="fixed">$</option></select></div>
                  <div><label className="label-sm block mb-1.5">Value *</label><input type="number" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: Number(e.target.value) }))} required min="1" className="input-box text-sm" /></div>
                </div>
                <div><label className="label-sm block mb-1.5">Min Order Amount ($)</label><input type="number" value={form.minimumOrderAmount} onChange={(e) => setForm((f) => ({ ...f, minimumOrderAmount: Number(e.target.value) }))} min="0" className="input-box text-sm" /></div>
                <div><label className="label-sm block mb-1.5">Usage Limit (blank = unlimited)</label><input type="number" value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))} min="1" className="input-box text-sm" placeholder="e.g. 100" /></div>
                <div><label className="label-sm block mb-1.5">Valid From *</label><input type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} required className="input-box text-sm" /></div>
                <div><label className="label-sm block mb-1.5">Valid Until *</label><input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} required className="input-box text-sm" /></div>
                <button type="submit" disabled={saving} className="btn-primary w-full justify-center text-xs">{saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Plus size={13} /> Create Coupon</>}</button>
              </form>
            </div>
          </div>
          <div className="lg:col-span-2 card overflow-hidden">
            <table className="table-base">
              <thead><tr><th>Code</th><th>Discount</th><th>Min Order</th><th>Usage</th><th>Valid Until</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-16" /></td>)}</tr>)
                  : coupons.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-outline">No coupons yet</td></tr>
                  : coupons.map((coupon) => (
                  <tr key={coupon._id}>
                    <td><span className="font-mono font-bold text-sm text-primary-900 bg-primary-50 px-2 py-0.5 rounded">{coupon.code}</span></td>
                    <td><span className="font-semibold">{coupon.discountType === 'percentage' ? `${coupon.discountValue}%` : `$${coupon.discountValue}`}</span></td>
                    <td><span className="text-sm">${coupon.minimumOrderAmount}</span></td>
                    <td><span className="text-sm">{coupon.usageCount}{coupon.usageLimit ? `/${coupon.usageLimit}` : ''}</span></td>
                    <td><span className="text-xs text-outline">{new Date(coupon.validUntil).toLocaleDateString()}</span></td>
                    <td>
                      {!coupon.isActive ? <span className="badge badge-neutral">Inactive</span>
                        : isExpired(coupon.validUntil) ? <span className="badge badge-error">Expired</span>
                        : <span className="badge badge-success">Active</span>}
                    </td>
                    <td><button onClick={() => handleDelete(coupon._id, coupon.code)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-outline hover:text-error transition-colors"><Trash2 size={13} /></button></td>
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

export default AdminCoupons;
