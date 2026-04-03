import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, ShoppingBag, Star } from 'lucide-react';
import { Product } from '@/types';
import { useAppDispatch, useAppSelector } from '@/store';
import { addToCart, openCart } from '@/store/slices/cartSlice';
import { updateUser } from '@/store/slices/authSlice';
import api from '@/api/axios';
import toast from 'react-hot-toast';

interface Props {
  product: Product;
  variant?: 'default' | 'compact' | 'horizontal';
}

const ProductCard = ({ product, variant = 'default' }: Props) => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, user } = useAppSelector((s) => s.auth);
  const [wishlisted, setWishlisted] = useState(
    () => user?.wishlist?.some((p) => p._id === product._id) ?? false
  );
  const [addingToCart, setAddingToCart] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) { toast.error('Please sign in to add items to cart'); return; }
    setAddingToCart(true);
    await dispatch(addToCart({ productId: product._id, quantity: 1 }));
    dispatch(openCart());
    setAddingToCart(false);
  };

  const handleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) { toast.error('Please sign in to save items'); return; }
    try {
      await api.post(`/products/${product._id}/wishlist`);
      const next = !wishlisted;
      setWishlisted(next);
      dispatch(updateUser({
        wishlist: next
          ? [...(user?.wishlist ?? []), product]
          : (user?.wishlist ?? []).filter((p) => p._id !== product._id),
      }));
      toast.success(next ? 'Added to wishlist' : 'Removed from wishlist');
    } catch { toast.error('Failed to update wishlist'); }
  };

  const primaryImage = product.images?.find((i) => i.isPrimary)?.url || product.images?.[0]?.url;
  const discountPct = product.compareAtPrice && product.compareAtPrice > product.price
    ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
    : 0;
  // Fallback for when the backend sends a lean() result without the inStock virtual
  const inStock = product.inStock !== undefined
    ? product.inStock
    : (!product.trackInventory || product.stock > 0);

  if (variant === 'horizontal') {
    return (
      <Link to={`/products/${product.slug}`} className="flex gap-4 group">
        <div className="w-20 h-20 flex-shrink-0 bg-surface-low rounded-md overflow-hidden">
          <img src={primaryImage || '/placeholder.jpg'} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface line-clamp-2 leading-snug group-hover:text-primary-900 transition-colors">{product.name}</p>
          <div className="flex items-center gap-1 mt-1">
            <Star size={11} className="text-yellow-400 fill-yellow-400" />
            <span className="text-xs text-outline">{product.rating?.average?.toFixed(1) || '0.0'} ({product.rating?.count || 0})</span>
          </div>
          <p className="text-sm font-bold text-primary-900 mt-1">${product.price.toFixed(2)}</p>
        </div>
      </Link>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="group relative"
    >
      <Link to={`/products/${product.slug}`} className="block">
        {/* Image container */}
        <div className="relative bg-surface-low rounded-md overflow-hidden aspect-[4/5] mb-3">
          {!imageLoaded && <div className="absolute inset-0 skeleton" />}
          <img
            src={primaryImage || '/placeholder.jpg'}
            alt={product.name}
            onLoad={() => setImageLoaded(true)}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5">
            {product.isTrending && <span className="badge badge-primary">Trending</span>}
            {product.isFeatured && <span className="badge badge-info">Featured</span>}
            {product.isNewArrival && <span className="badge badge-success">New</span>}
            {discountPct > 0 && <span className="badge badge-error">-{discountPct}%</span>}
            {inStock
              ? <span className="badge badge-success">In Stock</span>
              : <span className="badge badge-neutral">Out of Stock</span>}
          </div>

          {/* Action buttons — appear on hover */}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200">
            <button
              onClick={handleAddToCart}
              disabled={!inStock || addingToCart}
              className="flex-1 flex items-center justify-center gap-2 bg-white text-primary-900 text-xs font-bold uppercase tracking-widest py-2.5 px-3 rounded-md shadow-editorial hover:bg-primary-900 hover:text-white transition-all duration-200 disabled:opacity-50"
            >
              {addingToCart ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <ShoppingBag size={13} />
              )}
              {inStock ? 'Add to Cart' : 'Out of Stock'}
            </button>
            <button
              onClick={handleWishlist}
              className={`w-9 h-9 flex items-center justify-center bg-white rounded-md shadow-editorial transition-all duration-200 ${
                wishlisted ? 'text-red-500' : 'text-outline hover:text-red-500'
              }`}
            >
              <Heart size={14} className={wishlisted ? 'fill-current' : ''} />
            </button>
          </div>
        </div>

        {/* Info */}
        <div>
          {product.category && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-outline mb-1">
              {(product.category as any)?.name || ''}
            </p>
          )}
          <h3 className="text-sm font-medium text-on-surface line-clamp-2 leading-snug group-hover:text-primary-900 transition-colors">
            {product.name}
          </h3>

          {/* Rating */}
          {product.rating?.count > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={11}
                    className={s <= Math.round(product.rating.average) ? 'text-yellow-400 fill-yellow-400' : 'text-outline-variant'}
                  />
                ))}
              </div>
              <span className="text-[11px] text-outline">({product.rating.count})</span>
            </div>
          )}

          {/* Price */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-sm font-bold text-on-surface">${product.price.toFixed(2)}</span>
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <span className="text-xs text-outline line-through">${product.compareAtPrice.toFixed(2)}</span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

export default ProductCard;
