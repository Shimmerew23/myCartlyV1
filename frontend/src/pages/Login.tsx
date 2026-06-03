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

  const from = (location.state as any)?.from?.pathname || null;

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    const result = await dispatch(login(data));
    if (login.fulfilled.match(result)) {
      const user = (result.payload as any)?.user;
      const role = user?.role;
      const defaultPath =
        role === 'warehouse' ? '/warehouse/scan' :
        role === 'admin' || role === 'superadmin' ? '/admin/dashboard' :
        '/';
      navigate(from || defaultPath, { replace: true });
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
                { icon: '⬡', title: 'Secure Payments', desc: 'PayPal & GCash with end-to-end encryption' },
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
              <a
                href={`${import.meta.env.VITE_API_URL}/auth/google`}
                className="flex items-center justify-center gap-2.5 border border-outline-variant/30 rounded-md py-3 text-sm font-medium text-on-surface-variant hover:bg-surface-low hover:border-outline-variant/60 transition-all w-full"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </a>
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
