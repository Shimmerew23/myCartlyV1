import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ShoppingBag, Trash2 } from 'lucide-react';
import { useAppDispatch } from '@/store';
import { addToCart, openCart } from '@/store/slices/cartSlice';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import { Product } from '@/types';

const WishlistPage = () => {
  const dispatch = useAppDispatch();
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users/wishlist')
      .then(({ data }) => setWishlist(data.data || []))
      .catch(() => setWishlist([]))
      .finally(() => setLoading(false));
  }, []);

  const handleRemove = async (productId: string) => {
    try {
      await api.post(`/products/${productId}/wishlist`);
      setWishlist((prev) => prev.filter((p) => p._id !== productId));
      toast.success('Removed from wishlist');
    } catch {
      toast.error('Failed');
    }
  };

  const handleAddToCart = async (product: Product) => {
    await dispatch(addToCart({ productId: product._id, quantity: 1 }));
    dispatch(openCart());
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-8">
          <Heart size={22} className="text-primary-900 fill-primary-900" />
          <h1 className="font-headline text-3xl font-black tracking-tighter">My Wishlist</h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-outline-variant/20 overflow-hidden animate-pulse">
              <div className="aspect-[4/5] bg-surface-container" />
              <div className="p-4 space-y-2">
                <div className="h-3 bg-surface-container rounded w-3/4" />
                <div className="h-3 bg-surface-container rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet><title>Wishlist | CartLy</title></Helmet>
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-8">
          <Heart size={22} className="text-primary-900 fill-primary-900" />
          <h1 className="font-headline text-3xl font-black tracking-tighter">My Wishlist</h1>
          {wishlist.length > 0 && <span className="text-sm text-outline">({wishlist.length} item{wishlist.length !== 1 ? 's' : ''})</span>}
        </div>

        {wishlist.length === 0 ? (
          <div className="text-center py-20">
            <Heart size={48} className="text-outline mx-auto mb-4" />
            <h2 className="font-headline text-xl font-black mb-2">Your wishlist is empty</h2>
            <p className="text-outline mb-6">Save items you love by clicking the heart icon on any product</p>
            <Link to="/products" className="btn-primary">Discover Products</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {wishlist.map((product) => (
              <div key={product._id} className="group relative bg-white rounded-lg border border-outline-variant/20 overflow-hidden hover:shadow-editorial-lg transition-shadow flex flex-col">
                <Link to={`/products/${product.slug}`} className="block aspect-[4/5] bg-surface-low overflow-hidden">
                  <img src={product.images?.[0]?.url || '/placeholder.jpg'} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </Link>
                <button onClick={() => handleRemove(product._id)} className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow text-red-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100">
                  <Trash2 size={13} />
                </button>
                <div className="p-4 flex flex-col flex-1">
                  <Link to={`/products/${product.slug}`} className="text-sm font-semibold text-on-surface hover:text-primary-900 line-clamp-2 leading-snug transition-colors">{product.name}</Link>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-bold text-on-surface">${product.price.toFixed(2)}</span>
                    <span className={`text-xs font-semibold ${product.inStock ? 'text-success' : 'text-error'}`}>{product.inStock ? 'In Stock' : 'Out of Stock'}</span>
                  </div>
                  <button onClick={() => handleAddToCart(product)} disabled={!product.inStock} className="btn-primary w-full justify-center py-2 text-xs mt-auto pt-3 disabled:opacity-50">
                    <ShoppingBag size={13} /> Add to Cart
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default WishlistPage;
