// Login.tsx
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { login } from '@/store/slices/authSlice';
import { Helmet } from 'react-helmet-async';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

const LoginPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoading } = useAppSelector((s) => s.auth);
  const [showPassword, setShowPassword] = useState(false);

  const from = (location.state as any)?.from?.pathname || '/';

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    const result = await dispatch(login(data));
    if (login.fulfilled.match(result)) {
      navigate(from, { replace: true });
    }
  };

  return (
    <>
      <Helmet><title>Sign In | CartLy</title></Helmet>
      <div className="min-h-screen flex editorial-gradient">
        {/* Left Panel */}
        <div className="hidden lg:flex lg:w-[45%] flex-col justify-end p-16 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
          <div className="relative z-10">
            <h1 className="font-headline text-6xl font-black text-white tracking-tighter leading-none mb-6">
              The<br />CartLy
            </h1>
            <p className="text-white/60 font-body text-lg max-w-xs leading-relaxed mb-12">
              A premium marketplace where collectors discover extraordinary products.
            </p>
            <div className="space-y-6 border-t border-white/10 pt-10">
              {[
                { icon: '✦', title: 'Curated Selection', desc: 'Hand-picked products from verified sellers' },
                { icon: '⬡', title: 'Secure Payments', desc: 'Stripe-powered with end-to-end encryption' },
                { icon: '◈', title: 'Seller Ecosystem', desc: 'Join thousands of independent creators' },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-4">
                  <span className="text-white/40 text-lg mt-0.5">{f.icon}</span>
                  <div>
                    <p className="font-headline text-xs font-bold uppercase tracking-widest text-white">{f.title}</p>
                    <p className="text-white/40 text-sm mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute bottom-8 right-8 font-headline text-[18vw] font-black text-white/[0.03] leading-none uppercase select-none pointer-events-none">
            Sign
          </div>
        </div>

        {/* Right Panel */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="flex-1 bg-white flex flex-col justify-center px-8 sm:px-16 lg:px-20 py-12"
        >
          <div className="max-w-md w-full mx-auto">
            <div className="mb-12">
              <div className="inline-flex items-center gap-2 mb-8 lg:hidden">
                <div className="w-7 h-7 editorial-gradient rounded-sm flex items-center justify-center">
                  <span className="text-white font-black text-xs">TC</span>
                </div>
                <span className="font-headline font-black text-sm uppercase tracking-wider">CartLy</span>
              </div>
              <h2 className="font-headline text-4xl font-extrabold tracking-tighter text-on-surface mb-2">Welcome back</h2>
              <p className="text-on-surface-variant text-sm">Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
              <div>
                <label className="label-sm block mb-2">Email Address</label>
                <input
                  {...register('email')}
                  type="email"
                  placeholder="CartLy@editorial.com"
                  className="input-field"
                  autoComplete="email"
                />
                {errors.email && <p className="text-xs text-error mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="label-sm block mb-2">Password</label>
                <div className="relative">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    className="input-field pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-outline hover:text-primary-900 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-error mt-1">{errors.password.message}</p>}
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('rememberMe')} type="checkbox" className="w-3.5 h-3.5 accent-primary-900" />
                  <span className="text-xs text-on-surface-variant">Remember me</span>
                </label>
                <Link to="/forgot-password" className="text-xs text-primary-700 font-semibold hover:text-primary-900">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full justify-center py-4 text-xs"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <><span>Sign In</span><ArrowRight size={15} /></>
                )}
              </button>
            </form>

            {/* OAuth */}
            <div className="mt-8">
              <div className="relative flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-outline-variant/20" />
                <span className="text-xs text-outline">or continue with</span>
                <div className="flex-1 h-px bg-outline-variant/20" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Google', href: '/api/auth/google', emoji: 'G' },
                  { label: 'Facebook', href: '/api/auth/facebook', emoji: 'f' },
                ].map((p) => (
                  <a
                    key={p.label}
                    href={p.href}
                    className="flex items-center justify-center gap-2.5 border border-outline-variant/30 rounded-md py-3 text-sm font-medium text-on-surface-variant hover:bg-surface-low hover:border-outline-variant/60 transition-all"
                  >
                    <span className="font-bold text-base">{p.emoji}</span>
                    {p.label}
                  </a>
                ))}
              </div>
            </div>

            <p className="text-center text-sm text-outline mt-8">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary-700 font-bold hover:text-primary-900">
                Create one
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default LoginPage;
