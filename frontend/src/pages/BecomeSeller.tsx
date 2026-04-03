import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Store, Check, ArrowRight, Upload } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { upgradeToSeller } from '@/store/slices/authSlice';
import { Helmet } from 'react-helmet-async';

const BecomeSellerPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, isLoading } = useAppSelector((s) => s.auth);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<{ storeName: string; storeBio: string }>();

  if (user?.role === 'seller') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4"><Check size={28} className="text-success" /></div>
        <h2 className="font-headline text-2xl font-black mb-2">You're already a seller!</h2>
        <p className="text-outline mb-6">Visit your seller dashboard to manage your products and orders.</p>
        <button onClick={() => navigate('/seller/dashboard')} className="btn-primary">Go to Dashboard</button>
      </div>
    );
  }

  const onSubmit = async (data: any) => {
    const fd = new FormData();
    fd.append('storeName', data.storeName);
    fd.append('storeBio', data.storeBio);
    if (logoFile) fd.append('storeLogo', logoFile);
    const result = await dispatch(upgradeToSeller(fd));
    if (upgradeToSeller.fulfilled.match(result)) navigate('/seller/dashboard');
  };

  return (
    <>
      <Helmet><title>Become a Seller | CartLy</title></Helmet>
      <div className="max-w-5xl mx-auto px-4 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <p className="section-label justify-center mb-4">For Creators & Entrepreneurs</p>
          <h1 className="font-headline text-5xl font-black tracking-tighter text-on-surface mb-4">Start Selling on<br /><span className="text-primary-900">CartLy</span></h1>
          <p className="text-on-surface-variant text-lg max-w-xl mx-auto">Join thousands of independent sellers reaching customers worldwide. No listing fees, just a small commission on each sale.</p>
        </div>

        {/* Benefits */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
          {[{ icon: '📦', title: 'List for Free', desc: 'No upfront costs. Pay only when you sell.' }, { icon: '🌍', title: 'Global Reach', desc: 'Sell to customers in 180+ countries.' }, { icon: '📊', title: 'Seller Analytics', desc: 'Track views, sales, and revenue in real-time.' }].map((b) => (
            <div key={b.title} className="text-center p-6 bg-white rounded-lg border border-outline-variant/20 shadow-card">
              <span className="text-3xl">{b.icon}</span>
              <h3 className="font-headline font-black text-base mt-3 mb-1">{b.title}</h3>
              <p className="text-sm text-outline">{b.desc}</p>
            </div>
          ))}
        </div>

        {/* Application form */}
        <div className="max-w-2xl mx-auto bg-white rounded-lg border border-outline-variant/20 p-8">
          <h2 className="font-headline font-black text-2xl tracking-tighter mb-2 flex items-center gap-3"><Store size={20} /> Apply to Sell</h2>
          <p className="text-sm text-outline mb-6">Fill out this form to apply. Our team will review your application within 24 hours.</p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Logo upload */}
            <div>
              <label className="label-sm block mb-2">Store Logo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-surface-low border border-outline-variant/30 flex items-center justify-center">
                  {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" /> : <Store size={20} className="text-outline" />}
                </div>
                <label className="btn-secondary text-xs cursor-pointer"><Upload size={13} /> Upload Logo<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }}} /></label>
              </div>
            </div>
            <div>
              <label className="label-sm block mb-1.5">Store Name *</label>
              <input {...register('storeName', { required: 'Store name is required', minLength: { value: 3, message: 'Min 3 characters' } })} className="input-box text-sm" placeholder="e.g. Jane's Boutique" />
              {errors.storeName && <p className="text-xs text-error mt-1">{errors.storeName.message}</p>}
            </div>
            <div>
              <label className="label-sm block mb-1.5">Store Description *</label>
              <textarea {...register('storeBio', { required: 'Please describe your store', maxLength: { value: 500, message: 'Max 500 characters' } })} rows={4} className="input-box text-sm resize-none" placeholder="Tell buyers about your store, what you sell, and what makes you unique..." />
              {errors.storeBio && <p className="text-xs text-error mt-1">{errors.storeBio.message}</p>}
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-xs text-yellow-800">
              ⏳ After submitting, an admin will review your application. You'll receive an email once approved (usually within 24 hours).
            </div>
            <button type="submit" disabled={isLoading} className="btn-primary w-full justify-center py-4">
              {isLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><span>Submit Application</span><ArrowRight size={16} /></>}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

export default BecomeSellerPage;
