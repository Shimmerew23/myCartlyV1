import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check } from 'lucide-react';
import api from '@/api/axios';
import { Helmet } from 'react-helmet-async';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await api.post('/auth/forgot-password', { email }); setSent(true); } catch (err: any) { setError(err.response?.data?.message || 'Failed to send reset email'); }
    setLoading(false);
  };

  return (
    <>
      <Helmet><title>Forgot Password | CartLy</title></Helmet>
      <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-lg p-10 w-full max-w-md shadow-2xl">
          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5"><Check size={26} className="text-success" /></div>
              <h2 className="font-headline text-2xl font-black mb-2">Check your inbox</h2>
              <p className="text-on-surface-variant text-sm mb-2">We sent a password reset link to</p>
              <p className="font-bold text-primary-900">{email}</p>
              <p className="text-xs text-outline mt-3">The link expires in 10 minutes. Check your spam folder if you don't see it.</p>
              <Link to="/login" className="btn-primary mt-6 inline-flex">Back to Sign In</Link>
            </div>
          ) : (
            <>
              <Link to="/login" className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-outline hover:text-primary-900 mb-8 transition-colors"><ArrowLeft size={13} /> Back to Sign In</Link>
              <h2 className="font-headline text-3xl font-black tracking-tighter mb-2">Forgot Password?</h2>
              <p className="text-on-surface-variant text-sm mb-8">Enter your email address and we'll send you a link to reset your password.</p>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div><label className="label-sm block mb-2">Email Address</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="CartLy@editorial.com" className="input-field" /></div>
                {error && <p className="text-xs text-error">{error}</p>}
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-4">
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </>
  );
};

export default ForgotPasswordPage;
