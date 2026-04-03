// SellerLayout.tsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { LayoutDashboard, Package, ShoppingCart, User, LogOut, Store, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

const sellerNav = [
  { label: 'Dashboard', to: '/seller/dashboard', icon: LayoutDashboard },
  { label: 'My Products', to: '/seller/products', icon: Package },
  { label: 'Orders', to: '/seller/orders', icon: ShoppingCart },
  { label: 'Store Profile', to: '/seller/profile', icon: User },
];

const SellerLayout = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((s) => s.auth);

  return (
    <div className="min-h-screen flex bg-surface-low">
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-outline-variant/20">
        <div className="px-5 py-5 border-b border-outline-variant/10">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 editorial-gradient rounded-sm flex items-center justify-center">
              <Store size={14} className="text-white" />
            </div>
            <span className="font-headline font-black text-sm uppercase tracking-wider text-on-surface">
              Seller Hub
            </span>
          </Link>
        </div>

        <div className="px-3 py-2 border-b border-outline-variant/10">
          <Link to="/seller/products/new" className="btn-primary w-full justify-center text-xs py-2">
            <Plus size={14} /> Add Product
          </Link>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {sellerNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-outline-variant/10">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full editorial-gradient flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-on-surface truncate">{user?.name}</p>
              <p className="text-xs text-outline truncate">{user?.sellerProfile?.storeName || 'Seller'}</p>
            </div>
            <button onClick={() => { dispatch(logout()); navigate('/'); }} className="text-outline hover:text-error transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-outline-variant/20 px-6 h-14 flex items-center justify-between lg:hidden">
          <span className="font-headline font-black text-sm uppercase">Seller Hub</span>
          <div className="flex items-center gap-2">
            {sellerNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) =>
                `w-9 h-9 flex items-center justify-center rounded-md transition-colors ${isActive ? 'bg-primary-100 text-primary-900' : 'text-on-surface-variant hover:bg-surface-container'}`
              }>
                <item.icon size={16} />
              </NavLink>
            ))}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default SellerLayout;
