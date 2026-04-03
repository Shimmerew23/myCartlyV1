import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Lock } from 'lucide-react';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const ResetPasswordPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try { await api.put(`/auth/reset-password/${token}`, { password }); toast.success('Password reset!'); navigate('/login'); } catch (err: any) { toast.error(err.response?.data?.message || 'Reset failed. Link may be expired.'); }
    setLoading(false);
  };

  return (
    <>
      <Helmet><title>Reset Password | CartLy</title></Helmet>
      <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-lg p-10 w-full max-w-md shadow-2xl">
          <div className="w-12 h-12 rounded-full editorial-gradient flex items-center justify-center mb-6"><Lock size={18} className="text-white" /></div>
          <h2 className="font-headline text-3xl font-black tracking-tighter mb-2">Set New Password</h2>
          <p className="text-on-surface-variant text-sm mb-8">Enter a strong password. It must be at least 8 characters.</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label-sm block mb-2">New Password</label>
              <div className="relative">
                <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPass ? 'text' : 'password'} required minLength={8} placeholder="••••••••••••" className="input-field pr-10" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-0 top-1/2 -translate-y-1/2 text-outline hover:text-primary-900 transition-colors">{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            <div>
              <label className="label-sm block mb-2">Confirm Password</label>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" required placeholder="••••••••••••" className="input-field" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-4">
              {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Reset Password'}
            </button>
          </form>
          <p className="text-center text-sm text-outline mt-6"><Link to="/login" className="text-primary-700 font-bold hover:text-primary-900">Back to Sign In</Link></p>
        </motion.div>
      </div>
    </>
  );
};

export default ResetPasswordPage;
