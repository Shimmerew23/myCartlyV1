import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, MapPin, Bell, Shield, Plus, Trash2, Camera, Check } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { updateProfile, fetchMe } from '@/store/slices/authSlice';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const ProfilePage = () => {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.auth);
  const [tab, setTab] = useState<'profile' | 'addresses' | 'security' | 'notifications'>('profile');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { name: user?.name || '', phone: user?.phone || '' } });
  const pwdForm = useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();

  const onProfileSubmit = async (data: any) => {
    setSaving(true);
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => { if (v) fd.append(k, String(v)); });
    if (avatarFile) fd.append('avatar', avatarFile);
    await dispatch(updateProfile(fd));
    setSaving(false);
  };

  const onPasswordSubmit = async (data: any) => {
    if (data.newPassword !== data.confirmPassword) { toast.error('Passwords do not match'); return; }
    setChangingPwd(true);
    try { await api.put('/auth/change-password', data); toast.success('Password changed!'); pwdForm.reset(); } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); }
    setChangingPwd(false);
  };

  const resendVerificationEmail = async () => {
    setSendingVerification(true);
    try { await api.post('/auth/resend-verification'); toast.success('Verification email sent! Check your inbox.'); } catch (err: any) { toast.error(err.response?.data?.message || 'Failed to send verification email'); }
    setSendingVerification(false);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); }
  };

  const addAddress = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const addr: Record<string, any> = Object.fromEntries(
      [...fd.entries()].filter(([, v]) => v !== '')
    );
    addr.isDefault = fd.has('isDefault');
    try { await api.post('/users/addresses', addr); toast.success('Address added!'); (e.target as HTMLFormElement).reset(); dispatch(fetchMe()); } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const deleteAddress = async (id: string) => {
    try { await api.delete(`/users/addresses/${id}`); toast.success('Address removed'); dispatch(fetchMe()); } catch { toast.error('Failed'); }
  };

  const tabs = [{ key: 'profile', label: 'Profile', icon: User }, { key: 'addresses', label: 'Addresses', icon: MapPin }, { key: 'security', label: 'Security', icon: Shield }, { key: 'notifications', label: 'Notifications', icon: Bell }] as const;

  return (
    <>
      <Helmet><title>My Profile | CartLy</title></Helmet>
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="font-headline text-3xl font-black tracking-tighter mb-8">Account Settings</h1>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-outline-variant/20 p-4 space-y-1">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setTab(key as any)} className={tab === key ? 'nav-item-active w-full' : 'nav-item w-full'}>
                  <Icon size={15} />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="lg:col-span-3">
            {tab === 'profile' && (
              <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
                <h2 className="font-headline font-black text-lg mb-6">Profile Information</h2>
                {/* Avatar */}
                <div className="flex items-center gap-5 mb-6">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden editorial-gradient flex items-center justify-center">
                      {avatarPreview || user?.avatar
                        ? <img src={avatarPreview || user?.avatar} alt={user?.name} className="w-full h-full object-cover" />
                        : <span className="text-white text-2xl font-bold">{user?.name?.[0]?.toUpperCase()}</span>
                      }
                    </div>
                    <label className="absolute bottom-0 right-0 w-7 h-7 bg-primary-900 rounded-full flex items-center justify-center cursor-pointer shadow">
                      <Camera size={13} className="text-white" />
                      <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                    </label>
                  </div>
                  <div>
                    <p className="font-semibold text-on-surface">{user?.name}</p>
                    <p className="text-sm text-outline">{user?.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`badge ${user?.role === 'admin' ? 'badge-error' : user?.role === 'seller' ? 'badge-primary' : 'badge-neutral'}`}>{user?.role}</span>
                      {user?.isEmailVerified
                        ? <span className="flex items-center gap-1 text-xs text-success"><Check size={11} /> Verified</span>
                        : <button onClick={resendVerificationEmail} disabled={sendingVerification} className="text-xs text-warning hover:text-warning/70 underline underline-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            {sendingVerification ? 'Sending…' : 'Email unverified — Send verification email'}
                          </button>
                      }
                    </div>
                  </div>
                </div>
                <form onSubmit={handleSubmit(onProfileSubmit)} className="space-y-4">
                  <div><label className="label-sm block mb-1.5">Full Name</label><input {...register('name', { required: 'Name required' })} className="input-box text-sm" />{errors.name && <p className="text-xs text-error mt-1">{errors.name.message}</p>}</div>
                  <div><label className="label-sm block mb-1.5">Phone Number</label><input {...register('phone')} className="input-box text-sm" placeholder="+1 555 000 0000" /></div>
                  <div><label className="label-sm block mb-1.5">Email Address</label><input value={user?.email || ''} disabled className="input-box text-sm bg-surface-low cursor-not-allowed" /></div>
                  <button type="submit" disabled={saving} className="btn-primary text-xs">
                    {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Save Changes'}
                  </button>
                </form>
              </div>
            )}

            {tab === 'addresses' && (
              <div className="space-y-4">
                <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
                  <h2 className="font-headline font-black text-lg mb-4">Saved Addresses</h2>
                  {user?.addresses?.length === 0 ? (
                    <p className="text-sm text-outline py-4 text-center">No addresses saved yet</p>
                  ) : (
                    <div className="space-y-3">
                      {user?.addresses?.map((addr) => (
                        <div key={addr._id} className="flex items-start justify-between p-4 border border-outline-variant/20 rounded-lg">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold text-on-surface">{addr.label}</span>
                              {addr.isDefault && <span className="badge badge-primary text-[10px]">Default</span>}
                            </div>
                            <p className="text-sm text-outline">{addr.street}, {addr.city}, {addr.state} {addr.zipCode}, {addr.country}</p>
                          </div>
                          <button onClick={() => deleteAddress(addr._id)} className="text-outline hover:text-error transition-colors p-1"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
                  <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-4 flex items-center gap-2"><Plus size={14} /> Add New Address</h3>
                  <form onSubmit={addAddress} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2"><label className="label-sm block mb-1">Label</label><input name="label" className="input-box text-sm" placeholder="Home, Work, etc." /></div>
                    <div className="sm:col-span-2"><label className="label-sm block mb-1">Street *</label><input name="street" required className="input-box text-sm" placeholder="123 Main Street" /></div>
                    <div><label className="label-sm block mb-1">City *</label><input name="city" required className="input-box text-sm" /></div>
                    <div><label className="label-sm block mb-1">State *</label><input name="state" required className="input-box text-sm" /></div>
                    <div><label className="label-sm block mb-1">ZIP *</label><input name="zipCode" required className="input-box text-sm" /></div>
                    <div><label className="label-sm block mb-1">Country *</label><input name="country" required defaultValue="US" className="input-box text-sm" /></div>
                    <div className="sm:col-span-2 flex items-center gap-2"><input type="checkbox" name="isDefault" className="accent-primary-900" /><label className="text-sm text-on-surface-variant">Set as default address</label></div>
                    <div className="sm:col-span-2"><button type="submit" className="btn-primary text-xs"><Plus size={13} /> Add Address</button></div>
                  </form>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
                <h2 className="font-headline font-black text-lg mb-6">Security Settings</h2>
                <form onSubmit={pwdForm.handleSubmit(onPasswordSubmit)} className="space-y-4 max-w-md">
                  <h3 className="font-semibold text-sm text-on-surface">Change Password</h3>
                  <div><label className="label-sm block mb-1.5">Current Password</label><input {...pwdForm.register('currentPassword', { required: true })} type="password" className="input-box text-sm" /></div>
                  <div><label className="label-sm block mb-1.5">New Password</label><input {...pwdForm.register('newPassword', { required: true, minLength: 8 })} type="password" className="input-box text-sm" /></div>
                  <div><label className="label-sm block mb-1.5">Confirm New Password</label><input {...pwdForm.register('confirmPassword', { required: true })} type="password" className="input-box text-sm" /></div>
                  <button type="submit" disabled={changingPwd} className="btn-primary text-xs">
                    {changingPwd ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Shield size={13} /> Update Password</>}
                  </button>
                </form>
                <div className="mt-8 pt-6 border-t border-outline-variant/10">
                  <h3 className="font-semibold text-sm text-on-surface mb-2">Active Sessions</h3>
                  <p className="text-xs text-outline">For security, you can sign out of all other sessions.</p>
                  <button className="btn-secondary text-xs mt-3">Sign Out All Devices</button>
                </div>
              </div>
            )}

            {tab === 'notifications' && (
              <div className="bg-white rounded-lg border border-outline-variant/20 p-6">
                <h2 className="font-headline font-black text-lg mb-6">Notification Preferences</h2>
                <div className="space-y-4">
                  {[{ key: 'orderUpdates', label: 'Order Updates', desc: 'Shipping, delivery, and order status changes' }, { key: 'promotions', label: 'Promotions & Deals', desc: 'Sales, discounts, and special offers' }, { key: 'email', label: 'Email Notifications', desc: 'Receive notifications via email' }, { key: 'push', label: 'Push Notifications', desc: 'Browser push notifications' }].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between p-4 border border-outline-variant/20 rounded-lg">
                      <div><p className="text-sm font-semibold text-on-surface">{label}</p><p className="text-xs text-outline">{desc}</p></div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked={(user?.preferences?.notifications as any)?.[key]} className="sr-only peer" />
                        <div className="w-9 h-5 bg-outline-variant/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-primary-900 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                      </label>
                    </div>
                  ))}
                </div>
                <button className="btn-primary text-xs mt-6">Save Preferences</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ProfilePage;
