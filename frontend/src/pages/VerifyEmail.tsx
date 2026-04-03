import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, X, Loader2 } from 'lucide-react';
import api from '@/api/axios';
import { Helmet } from 'react-helmet-async';

const VerifyEmailPage = () => {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (!token) { setStatus('error'); return; }
    api.get(`/auth/verify-email/${token}`).then(() => setStatus('success')).catch(() => setStatus('error'));
  }, [token]);

  return (
    <>
      <Helmet><title>Verify Email | CartLy</title></Helmet>
      <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-lg p-12 w-full max-w-md shadow-2xl text-center">
          {status === 'loading' && (<><div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-6"><Loader2 size={28} className="text-primary-900 animate-spin" /></div><h2 className="font-headline text-2xl font-black">Verifying your email...</h2><p className="text-outline text-sm mt-2">Please wait a moment</p></>)}
          {status === 'success' && (<><div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6"><Check size={28} className="text-success" /></div><h2 className="font-headline text-2xl font-black mb-2">Email Verified!</h2><p className="text-on-surface-variant text-sm mb-6">Your email has been verified successfully. Your account is now fully activated.</p><Link to="/" className="btn-primary">Go to Home</Link></>)}
          {status === 'error' && (<><div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6"><X size={28} className="text-error" /></div><h2 className="font-headline text-2xl font-black mb-2 text-error">Verification Failed</h2><p className="text-on-surface-variant text-sm mb-6">This verification link is invalid or has expired. Please request a new one.</p><Link to="/login" className="btn-secondary">Back to Sign In</Link></>)}
        </motion.div>
      </div>
    </>
  );
};

export default VerifyEmailPage;
