import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Store, Upload, BarChart2, Package, DollarSign, Star, Globe, Instagram, Twitter, Save } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store';
import { fetchMe } from '@/store/slices/authSlice';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const SellerProfilePage = () => {
  const { user } = useAppSelector((s) => s.auth);
  const dispatch = useAppDispatch();
  const profile = user?.sellerProfile;
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(profile?.storeLogo || null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(profile?.storeBanner || null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'social' | 'stats'>('profile');

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      storeName: profile?.storeName || '',
      storeBio: profile?.storeBio || '',
      storeEmail: profile?.storeEmail || user?.email || '',
      storePhone: profile?.storePhone || '',
      returnPolicy: profile?.returnPolicy || '30-day return policy. Items must be unused and in original packaging.',
      shippingPolicy: profile?.shippingPolicy || 'Orders ship within 1-2 business days.',
      website: profile?.socialLinks?.website || '',
      instagram: profile?.socialLinks?.instagram || '',
      twitter: profile?.socialLinks?.twitter || '',
    },
  });

  const onSubmit = async (data: any) => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('storeName', data.storeName);
      fd.append('storeBio', data.storeBio);
      fd.append('storeEmail', data.storeEmail);
      fd.append('storePhone', data.storePhone);
      fd.append('returnPolicy', data.returnPolicy);
      fd.append('shippingPolicy', data.shippingPolicy);
      fd.append('socialLinks', JSON.stringify({ website: data.website, instagram: data.instagram, twitter: data.twitter }));
      if (logoFile) fd.append('storeLogo', logoFile);
      if (bannerFile) fd.append('storeBanner', bannerFile);
      await api.put('/users/seller-profile', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      dispatch(fetchMe());
      toast.success('Store profile updated!');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed to update profile'); }
    setSaving(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'banner') => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    if (type === 'logo') { setLogoFile(f); setLogoPreview(url); }
    else { setBannerFile(f); setBannerPreview(url); }
  };

  const tabs = [{ key: 'profile', label: 'Store Info' }, { key: 'social', label: 'Social & Policies' }, { key: 'stats', label: 'Stats' }] as const;

  return (
    <>
      <Helmet><title>Store Profile | Seller</title></Helmet>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="font-headline text-2xl font-black tracking-tighter">Store Profile</h1>
          <p className="text-sm text-outline mt-0.5">Manage how your store appears to customers</p>
        </div>

        {/* Approval status */}
        {!profile?.isApproved && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
            ⏳ Your seller application is pending admin approval. You'll be notified by email once approved.
          </div>
        )}

        {/* Banner preview */}
        <div className="relative h-36 rounded-lg overflow-hidden bg-surface-low border border-outline-variant/20 group">
          {bannerPreview ? <img src={bannerPreview} alt="Store banner" className="w-full h-full object-cover" /> : <div className="w-full h-full editorial-gradient opacity-80" />}
          <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
            <div className="flex flex-col items-center text-white gap-1"><Upload size={20} /><span className="text-xs font-semibold">Change Banner</span></div>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e, 'banner')} />
          </label>
          {/* Logo overlaid */}
          <div className="absolute bottom-3 left-4 flex items-end gap-3">
            <div className="relative w-16 h-16 rounded-full overflow-hidden bg-white border-4 border-white shadow-lg group/logo">
              {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" /> : <div className="w-full h-full editorial-gradient flex items-center justify-center"><Store size={20} className="text-white" /></div>}
              <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/logo:opacity-100 transition-opacity cursor-pointer rounded-full">
                <Upload size={13} className="text-white" />
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e, 'logo')} />
              </label>
            </div>
            <div className="pb-1"><p className="font-headline font-black text-white text-sm">{profile?.storeName || 'Your Store'}</p><p className="text-white/70 text-xs">{profile?.storeSlug ? `@${profile.storeSlug}` : 'Pending approval'}</p></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outline-variant/20">
          {tabs.map((t) => <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-5 py-2.5 text-xs font-black uppercase tracking-widest border-b-2 -mb-px transition-colors ${activeTab === t.key ? 'border-primary-900 text-primary-900' : 'border-transparent text-outline hover:text-on-surface'}`}>{t.label}</button>)}
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div><label className="label-sm block mb-1.5">Store Name *</label><input {...register('storeName', { required: 'Required' })} className="input-box text-sm" placeholder="Your Store Name" />{errors.storeName && <p className="text-xs text-error mt-1">{errors.storeName.message}</p>}</div>
              <div><label className="label-sm block mb-1.5">Store Bio *</label><textarea {...register('storeBio', { required: 'Required', maxLength: { value: 500, message: 'Max 500 chars' } })} rows={4} className="input-box text-sm resize-none" placeholder="Describe your store in a few sentences..." />{errors.storeBio && <p className="text-xs text-error mt-1">{errors.storeBio.message}</p>}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-sm block mb-1.5">Contact Email</label><input {...register('storeEmail')} type="email" className="input-box text-sm" /></div>
                <div><label className="label-sm block mb-1.5">Contact Phone</label><input {...register('storePhone')} className="input-box text-sm" placeholder="+1 555 000 0000" /></div>
              </div>
            </div>
          )}

          {activeTab === 'social' && (
            <div className="space-y-4">
              <div>
                <label className="label-sm block mb-1.5 flex items-center gap-2"><Globe size={12} /> Website</label>
                <input {...register('website')} className="input-box text-sm" placeholder="https://yourstore.com" />
              </div>
              <div>
                <label className="label-sm block mb-1.5 flex items-center gap-2"><Instagram size={12} /> Instagram</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">@</span><input {...register('instagram')} className="input-box text-sm pl-7" placeholder="yourhandle" /></div>
              </div>
              <div>
                <label className="label-sm block mb-1.5 flex items-center gap-2"><Twitter size={12} /> Twitter / X</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">@</span><input {...register('twitter')} className="input-box text-sm pl-7" placeholder="yourhandle" /></div>
              </div>
              <hr className="border-outline-variant/20" />
              <div><label className="label-sm block mb-1.5">Return Policy</label><textarea {...register('returnPolicy')} rows={3} className="input-box text-sm resize-none" /></div>
              <div><label className="label-sm block mb-1.5">Shipping Policy</label><textarea {...register('shippingPolicy')} rows={3} className="input-box text-sm resize-none" /></div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icon: Package, label: 'Total Sales', value: profile?.totalSales?.toLocaleString() || '0' },
                { icon: DollarSign, label: 'Total Revenue', value: `$${(profile?.totalRevenue || 0).toLocaleString()}` },
                { icon: Star, label: 'Store Rating', value: profile?.rating ? `${profile.rating.toFixed(1)} ★` : 'No ratings' },
                { icon: BarChart2, label: 'Member Since', value: user?.createdAt ? new Date(user.createdAt).getFullYear().toString() : '—' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="card p-5 text-center">
                  <Icon size={20} className="text-primary-700 mx-auto mb-2" />
                  <p className="font-headline font-black text-xl text-on-surface">{value}</p>
                  <p className="text-xs text-outline mt-0.5">{label}</p>
                </div>
              ))}
              <div className="col-span-2 sm:col-span-4 bg-surface-low rounded-lg p-4 text-center">
                <p className="text-sm text-outline">More analytics available in your <strong className="text-on-surface">Dashboard</strong></p>
              </div>
            </div>
          )}

          {activeTab !== 'stats' && (
            <div className="pt-5 mt-5 border-t border-outline-variant/10">
              <button type="submit" disabled={saving} className="btn-primary text-xs">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Save size={13} /> Save Changes</>}
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
};

export default SellerProfilePage;
