import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { toggleCart } from '@/store/slices/cartSlice';
import {
  ShoppingBag, Search, User, Menu, X, ChevronDown,
  LogOut, Package, Heart, Settings, LayoutDashboard,
  Store, Bell, Shield, MessageSquare
} from 'lucide-react';
import api from '@/api/axios';
import { Product } from '@/types';
import { findClosestMatch } from '@/utils/fuzzy';
import FeedbackModal from '@/components/feedback/FeedbackModal';

const Navbar = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useAppSelector((s) => s.auth);
  const { itemCount } = useAppSelector((s) => s.cart);

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const productNamesCache = useRef<string[]>([]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
    setProfileOpen(false);
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setSuggestion(null);
    clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: q, limit: 5 } });
        const results: Product[] = data.data || [];
        setSearchResults(results);
        if (results.length === 0) {
          if (productNamesCache.current.length === 0) {
            const { data: all } = await api.get('/products', { params: { limit: 100 } });
            productNamesCache.current = (all.data || []).map((p: Product) => p.name);
          }
          setSuggestion(findClosestMatch(q, productNamesCache.current));
        }
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/');
  };

  const navLinks = [
    { label: 'Shop', to: '/products' },
    { label: 'New Arrivals', to: '/products?newArrival=true' },
    { label: 'Trending', to: '/products?trending=true' },
  ];

  const userMenuItems = [
    { icon: User, label: 'My Profile', to: '/profile' },
    { icon: Package, label: 'My Orders', to: '/orders' },
    { icon: Heart, label: 'Wishlist', to: '/wishlist' },
    ...(user?.role === 'user' ? [{ icon: Store, label: 'Become a Seller', to: '/become-seller' }] : []),
    ...(user && ['seller', 'admin', 'superadmin'].includes(user.role)
      ? [{ icon: LayoutDashboard, label: 'Seller Dashboard', to: '/seller/dashboard' }] : []),
    ...(user && ['admin', 'superadmin'].includes(user.role)
      ? [{ icon: Shield, label: 'Admin Panel', to: '/admin/dashboard' }] : []),
    { icon: Settings, label: 'Settings', to: '/profile?tab=settings' },
  ];

  const handleFeedbackClick = () => {
    setProfileOpen(false);
    setFeedbackOpen(true);
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/95 backdrop-blur-xl shadow-editorial' : 'bg-white border-b border-outline-variant/20'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0 flex items-center gap-3 group">
            <div className="w-8 h-8 editorial-gradient rounded-sm flex items-center justify-center">
              <span className="text-white font-headline font-black text-sm">TC</span>
            </div>
            <span className="font-headline font-extrabold text-lg tracking-tighter text-on-surface uppercase">
              CartLy
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`font-headline text-xs font-bold uppercase tracking-widest transition-colors ${
                  (location.pathname + location.search) === link.to
                    ? 'text-primary-900'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div ref={searchRef} className="relative">
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
                aria-label="Search"
              >
                <Search size={18} className="text-on-surface-variant" />
              </button>

              <AnimatePresence>
                {searchOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-12 w-80 bg-white rounded-lg shadow-editorial-lg border border-outline-variant/20 overflow-hidden z-50"
                  >
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/20">
                      <Search size={16} className="text-outline flex-shrink-0" />
                      <input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search products..."
                        className="flex-1 text-sm bg-transparent outline-none text-on-surface placeholder:text-outline"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && searchQuery) {
                            navigate(`/products?search=${encodeURIComponent(searchQuery)}`);
                            setSearchOpen(false);
                          }
                        }}
                      />
                      {searching && (
                        <div className="w-4 h-4 border-2 border-primary-900 border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>

                    {searchResults.length > 0 && (
                      <div className="py-2">
                        {searchResults.map((product) => (
                          <Link
                            key={product._id}
                            to={`/products/${product.slug}`}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-low transition-colors"
                            onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                          >
                            <img
                              src={product.images[0]?.url || '/placeholder.jpg'}
                              alt={product.name}
                              className="w-10 h-10 object-cover rounded-sm flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-on-surface truncate">{product.name}</p>
                              <p className="text-xs text-primary-900 font-bold">${product.price.toFixed(2)}</p>
                            </div>
                          </Link>
                        ))}
                        <div className="px-4 py-2 border-t border-outline-variant/10">
                          <button
                            onClick={() => {
                              navigate(`/products?search=${encodeURIComponent(searchQuery)}`);
                              setSearchOpen(false);
                            }}
                            className="text-xs text-primary-700 font-semibold hover:text-primary-900"
                          >
                            See all results for "{searchQuery}" →
                          </button>
                        </div>
                      </div>
                    )}

                    {searchQuery && !searching && searchResults.length === 0 && (
                      <div className="px-4 py-6 text-center">
                        <p className="text-sm text-outline">No products found for "{searchQuery}"</p>
                        {suggestion && (
                          <button
                            onClick={() => handleSearch(suggestion)}
                            className="mt-2 text-xs font-semibold text-primary-700 hover:text-primary-900"
                          >
                            Did you mean "<span className="underline">{suggestion}</span>"?
                          </button>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Cart */}
            <button
              onClick={() => dispatch(toggleCart())}
              className="relative w-10 h-10 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
              aria-label="Cart"
            >
              <ShoppingBag size={18} className="text-on-surface-variant" />
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-primary-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {itemCount > 99 ? '99+' : itemCount}
                </span>
              )}
            </button>

            {/* User */}
            {isAuthenticated ? (
              <div ref={profileRef} className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex items-center gap-2 h-10 px-2 rounded-md hover:bg-surface-container transition-colors"
                >
                  {user?.avatar ? (
                    <img src={user.avatar} alt={user.name} className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full editorial-gradient flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{user?.name?.[0]?.toUpperCase()}</span>
                    </div>
                  )}
                  <ChevronDown size={14} className="text-outline hidden sm:block" />
                </button>

                <AnimatePresence>
                  {profileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-12 w-56 bg-white rounded-lg shadow-editorial-lg border border-outline-variant/20 overflow-hidden z-50"
                    >
                      <div className="px-4 py-3 border-b border-outline-variant/10">
                        <p className="text-sm font-semibold text-on-surface">{user?.name}</p>
                        <p className="text-xs text-outline truncate">{user?.email}</p>
                        <span className={`mt-1 inline-block badge ${
                          user?.role === 'admin' || user?.role === 'superadmin' ? 'badge-error' :
                          user?.role === 'seller' ? 'badge-primary' : 'badge-neutral'
                        }`}>
                          {user?.role}
                        </span>
                      </div>
                      <div className="py-1">
                        {userMenuItems.map((item) => (
                          <Link
                            key={item.to}
                            to={item.to}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-low hover:text-on-surface transition-colors"
                          >
                            <item.icon size={15} />
                            {item.label}
                          </Link>
                        ))}
                      </div>
                      <div className="border-t border-outline-variant/10 py-1">
                        <button
                          onClick={handleFeedbackClick}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-low hover:text-on-surface transition-colors"
                        >
                          <MessageSquare size={15} />
                          Send Feedback
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-red-50 transition-colors"
                        >
                          <LogOut size={15} />
                          Sign Out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={() => setFeedbackOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors px-2 py-1"
                >
                  <MessageSquare size={14} />
                  Feedback
                </button>
                <Link to="/login" className="btn-ghost text-xs">Sign In</Link>
                <Link to="/register" className="btn-primary text-xs py-2">Join Now</Link>
              </div>
            )}

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden border-t border-outline-variant/20 bg-white overflow-hidden"
          >
            <div className="px-4 py-4 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="block px-3 py-2.5 font-headline text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary-900 hover:bg-surface-low rounded-md transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              {!isAuthenticated && (
                <div className="pt-3 border-t border-outline-variant/10 flex flex-col gap-2">
                  <button
                    onClick={() => { setMobileOpen(false); setFeedbackOpen(true); }}
                    className="flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface-variant hover:text-primary-900 hover:bg-surface-low rounded-md transition-colors"
                  >
                    <MessageSquare size={15} />
                    Send Feedback
                  </button>
                  <Link to="/login" className="btn-secondary w-full justify-center">Sign In</Link>
                  <Link to="/register" className="btn-primary w-full justify-center">Create Account</Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Navbar;
