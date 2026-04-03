import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, Package, ShoppingCart, Tag,
  Ticket, FileText, Truck, LogOut, Menu, X, ChevronRight,
  Bell, Settings, Shield, MessageSquare
} from 'lucide-react';

const adminNav = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Users', to: '/admin/users', icon: Users },
  { label: 'Products', to: '/admin/products', icon: Package },
  { label: 'Orders', to: '/admin/orders', icon: ShoppingCart },
  { label: 'Categories', to: '/admin/categories', icon: Tag },
  { label: 'Carriers', to: '/admin/carriers', icon: Truck },
  { label: 'Coupons', to: '/admin/coupons', icon: Ticket },
  { label: 'Audit Logs', to: '/admin/audit-logs', icon: FileText, superadmin: true },
  { label: 'Feedback', to: '/admin/feedback', icon: MessageSquare },
];

const AdminLayout = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((s) => s.auth);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const handleLogout = () => { dispatch(logout()); navigate('/'); };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-sm flex items-center justify-center">
            <Shield size={16} className="text-white" />
          </div>
          {sidebarOpen && (
            <div>
              <p className="font-headline font-black text-white text-sm uppercase tracking-wider">Admin</p>
              <p className="text-white/50 text-xs">CartLy</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {adminNav
          .filter((item) => !item.superadmin || user?.role === 'superadmin')
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <item.icon size={16} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
      </nav>

      {/* User Info */}
      <div className="px-3 py-4 border-t border-white/10">
        {sidebarOpen ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.name}</p>
              <p className="text-white/50 text-xs truncate">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="text-white/50 hover:text-white transition-colors">
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center py-2 text-white/50 hover:text-white transition-colors"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-surface-low">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col editorial-gradient transition-all duration-300 ${
          sidebarOpen ? 'w-60' : 'w-16'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -256 }}
              animate={{ x: 0 }}
              exit={{ x: -256 }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 left-0 w-64 editorial-gradient z-50 lg:hidden flex flex-col"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-outline-variant/20 px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex w-8 h-8 items-center justify-center rounded-md hover:bg-surface-container transition-colors"
          >
            {sidebarOpen ? <ChevronRight size={16} className="rotate-180" /> : <ChevronRight size={16} />}
          </button>
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
          >
            <Menu size={16} />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <button className="relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors">
              <Bell size={16} className="text-on-surface-variant" />
            </button>
            <div className="w-8 h-8 rounded-full editorial-gradient flex items-center justify-center text-white font-bold text-xs">
              {user?.name?.[0]?.toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
