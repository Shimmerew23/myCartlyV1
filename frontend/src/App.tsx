import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from './store';
import { fetchMe, clearAuth } from './store/slices/authSlice';
import { fetchCart } from './store/slices/cartSlice';

// Layouts
import MainLayout from './components/layout/MainLayout';
import AdminLayout from './components/layout/AdminLayout';
import SellerLayout from './components/layout/SellerLayout';

// Auth pages
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import ForgotPasswordPage from './pages/ForgotPassword';
import ResetPasswordPage from './pages/ResetPassword';
import VerifyEmailPage from './pages/VerifyEmail';

// Public pages
import HomePage from './pages/Home';
import ProductsPage from './pages/Products';
import ProductDetailPage from './pages/ProductDetail';
import StorePage from './pages/Store';
import CartPage from './pages/Cart';
import CheckoutPage from './pages/Checkout';

// User pages
import ProfilePage from './pages/Profile';
import OrdersPage from './pages/Orders';
import OrderDetailPage from './pages/OrderDetail';
import WishlistPage from './pages/Wishlist';

// Seller pages
import SellerDashboard from './pages/seller/Dashboard';
import SellerProducts from './pages/seller/Products';
import SellerAddProduct from './pages/seller/AddProduct';
import SellerEditProduct from './pages/seller/EditProduct';
import SellerOrders from './pages/seller/Orders';
import SellerProfile from './pages/seller/Profile';
import BecomeSellerPage from './pages/BecomeSeller';

// Admin pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminProducts from './pages/admin/Products';
import AdminOrders from './pages/admin/Orders';
import AdminCategories from './pages/admin/Categories';
import AdminCoupons from './pages/admin/Coupons';
import AdminAuditLogs from './pages/admin/AuditLogs';
import AdminCarriers from './pages/admin/Carriers';
import AdminFeedback from './pages/admin/Feedback';

// Guards
import ProtectedRoute from './components/auth/ProtectedRoute';
import CartSidebar from './components/cart/CartSidebar';

function App() {
  const dispatch = useAppDispatch();
  const { token, isAuthenticated } = useAppSelector((state) => state.auth);

  useEffect(() => {
    // Initialize auth from stored token
    if (token) {
      dispatch(fetchMe());
    }

    // Listen for logout events (from axios interceptor)
    const handleLogout = () => dispatch(clearAuth());
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      dispatch(fetchCart());
    }
  }, [isAuthenticated]);

  return (
    <BrowserRouter>
      <CartSidebar />
      <Routes>
        {/* Auth Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/verify-email/:token" element={<VerifyEmailPage />} />

        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:slug" element={<ProductDetailPage />} />
          <Route path="/store/:slug" element={<StorePage />} />
          <Route path="/cart" element={<CartPage />} />

          {/* Protected user routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/become-seller" element={<BecomeSellerPage />} />
          </Route>
        </Route>

        {/* Seller Layout Routes */}
        <Route element={<ProtectedRoute allowedRoles={['seller', 'admin', 'superadmin']} />}>
          <Route element={<SellerLayout />}>
            <Route path="/seller" element={<Navigate to="/seller/dashboard" replace />} />
            <Route path="/seller/dashboard" element={<SellerDashboard />} />
            <Route path="/seller/products" element={<SellerProducts />} />
            <Route path="/seller/products/new" element={<SellerAddProduct />} />
            <Route path="/seller/products/:id/edit" element={<SellerEditProduct />} />
            <Route path="/seller/orders" element={<SellerOrders />} />
            <Route path="/seller/profile" element={<SellerProfile />} />
          </Route>
        </Route>

        {/* Admin Layout Routes */}
        <Route element={<ProtectedRoute allowedRoles={['admin', 'superadmin']} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/categories" element={<AdminCategories />} />
            <Route path="/admin/coupons" element={<AdminCoupons />} />
            <Route path="/admin/carriers" element={<AdminCarriers />} />
            <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
            <Route path="/admin/feedback" element={<AdminFeedback />} />
          </Route>
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
