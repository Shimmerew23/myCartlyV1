// Register.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, Check } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { register as registerUser } from '@/store/slices/authSlice';
import { Helmet } from 'react-helmet-async';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

const RegisterPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isLoading } = useAppSelector((s) => s.auth);
  const [showPass, setShowPass] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const password = watch('password', '');
  const checks = [
    { label: '8+ characters', valid: password.length >= 8 },
    { label: 'Uppercase letter', valid: /[A-Z]/.test(password) },
    { label: 'Number', valid: /[0-9]/.test(password) },
    { label: 'Special character', valid: /[^A-Za-z0-9]/.test(password) },
  ];

  const onSubmit = async (data: FormData) => {
    if (!agreed) return;
    const result = await dispatch(registerUser(data));
    if (registerUser.fulfilled.match(result)) navigate('/');
  };

  return (
    <>
      <Helmet><title>Create Account | CartLy</title></Helmet>
      <div className="min-h-screen flex editorial-gradient">
        <div className="hidden lg:flex lg:w-[45%] flex-col justify-end p-16 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
          <div className="relative z-10 text-white">
            <h1 className="font-headline text-6xl font-black tracking-tighter leading-none mb-6">
              Join the<br />Archive
            </h1>
            <p className="text-white/60 text-lg max-w-xs leading-relaxed mb-12">
              Become part of an elite network of CartLys, collectors, and independent creators.
            </p>
          </div>
          <div className="absolute bottom-8 right-8 font-headline text-[18vw] font-black text-white/[0.03] leading-none uppercase select-none pointer-events-none">Join</div>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="flex-1 bg-white flex flex-col justify-center px-8 sm:px-16 lg:px-20 py-12"
        >
          <div className="max-w-md w-full mx-auto">
            <div className="mb-10">
              <h2 className="font-headline text-4xl font-extrabold tracking-tighter text-on-surface mb-2">Create account</h2>
              <p className="text-on-surface-variant text-sm">Join thousands of CartLys worldwide</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-7">
              <div>
                <label className="label-sm block mb-2">Full Name</label>
                <input {...register('name')} placeholder="Alexander Vogue" className="input-field" />
                {errors.name && <p className="text-xs text-error mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="label-sm block mb-2">Email Address</label>
                <input {...register('email')} type="email" placeholder="CartLy@editorial.com" className="input-field" />
                {errors.email && <p className="text-xs text-error mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="label-sm block mb-2">Password</label>
                <div className="relative">
                  <input
                    {...register('password')}
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    className="input-field pr-10"
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-0 top-1/2 -translate-y-1/2 text-outline hover:text-primary-900 transition-colors">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password && (
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {checks.map((c) => (
                      <div key={c.label} className={`flex items-center gap-1.5 text-xs ${c.valid ? 'text-success' : 'text-outline'}`}>
                        <Check size={11} className={c.valid ? 'opacity-100' : 'opacity-30'} />
                        {c.label}
                      </div>
                    ))}
                  </div>
                )}
                {errors.password && <p className="text-xs text-error mt-1">{errors.password.message}</p>}
              </div>

              <div>
                <label className="label-sm block mb-2">Confirm Password</label>
                <input {...register('confirmPassword')} type="password" placeholder="••••••••••••" className="input-field" />
                {errors.confirmPassword && <p className="text-xs text-error mt-1">{errors.confirmPassword.message}</p>}
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="w-3.5 h-3.5 accent-primary-900 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-on-surface-variant leading-relaxed">
                  I agree to the{' '}
                  <a href="#" className="text-primary-700 font-semibold underline underline-offset-2">Terms of Service</a>
                  {' '}and{' '}
                  <a href="#" className="text-primary-700 font-semibold underline underline-offset-2">Privacy Policy</a>
                </span>
              </label>

              <button type="submit" disabled={isLoading || !agreed} className="btn-primary w-full justify-center py-4 text-xs">
                {isLoading
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><span>Create Account</span><ArrowRight size={15} /></>
                }
              </button>
            </form>

            <p className="text-center text-sm text-outline mt-8">
              Already have an account?{' '}
              <Link to="/login" className="text-primary-700 font-bold hover:text-primary-900">Sign in</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default RegisterPage;

// ForgotPassword.tsx (exported as named export for simplicity)
export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { default: api } = await import('@/api/axios');
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {}
    setLoading(false);
  };

  return (
    <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-lg p-10 w-full max-w-md shadow-2xl">
        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check size={24} className="text-success" />
            </div>
            <h2 className="font-headline text-2xl font-black mb-2">Check your email</h2>
            <p className="text-on-surface-variant text-sm">We've sent a password reset link to <strong>{email}</strong></p>
            <Link to="/login" className="btn-primary mt-6 inline-flex">Back to Sign In</Link>
          </div>
        ) : (
          <>
            <h2 className="font-headline text-3xl font-black tracking-tighter mb-2">Reset Password</h2>
            <p className="text-on-surface-variant text-sm mb-8">Enter your email and we'll send you a reset link.</p>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="label-sm block mb-2">Email Address</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="CartLy@editorial.com" className="input-field" />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Send Reset Link'}
              </button>
            </form>
            <p className="text-center text-sm text-outline mt-6">
              <Link to="/login" className="text-primary-700 font-bold">Back to Sign In</Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
};

export const ResetPasswordPage = () => {
  const { token } = { token: window.location.pathname.split('/').pop() };
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { default: api } = await import('@/api/axios');
      await api.put(`/auth/reset-password/${token}`, { password });
      navigate('/login');
    } catch {}
    setLoading(false);
  };

  return (
    <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-lg p-10 w-full max-w-md shadow-2xl">
        <h2 className="font-headline text-3xl font-black tracking-tighter mb-2">New Password</h2>
        <p className="text-on-surface-variant text-sm mb-8">Enter your new password below.</p>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="label-sm block mb-2">New Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={8} placeholder="••••••••••••" className="input-field" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Reset Password'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export const VerifyEmailPage = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useState(() => {
    const token = window.location.pathname.split('/').pop();
    import('@/api/axios').then(({ default: api }) =>
      api.get(`/auth/verify-email/${token}`)
        .then(() => setStatus('success'))
        .catch(() => setStatus('error'))
    );
  });

  return (
    <div className="min-h-screen editorial-gradient flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-lg p-10 w-full max-w-md shadow-2xl text-center">
        {status === 'loading' && <div className="w-8 h-8 border-2 border-primary-900 border-t-transparent rounded-full animate-spin mx-auto" />}
        {status === 'success' && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"><Check size={24} className="text-success" /></div>
            <h2 className="font-headline text-2xl font-black mb-2">Email Verified!</h2>
            <p className="text-on-surface-variant text-sm">Your account is now fully activated.</p>
            <Link to="/" className="btn-primary mt-6 inline-flex">Go to Home</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 className="font-headline text-2xl font-black mb-2 text-error">Invalid Link</h2>
            <p className="text-on-surface-variant text-sm">This link is invalid or has expired.</p>
            <Link to="/login" className="btn-secondary mt-6 inline-flex">Back to Sign In</Link>
          </>
        )}
      </motion.div>
    </div>
  );
};

// Need this for named imports in App.tsx
import { useState as useStateAlias } from 'react';
const useNavigate2 = useNavigate;
