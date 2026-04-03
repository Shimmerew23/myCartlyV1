import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingBag, Heart, Star, ChevronLeft, ChevronRight,
  Truck, Shield, RotateCcw, Share2, Minus, Plus,
  MessageSquare, ThumbsUp, Check, Store, Package
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { fetchProduct } from '@/store/slices/productSlice';
import { addToCart, openCart } from '@/store/slices/cartSlice';
import { Product, Review } from '@/types';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';
import ProductCard from '@/components/products/ProductCard';

const StarBar = ({ count, total, rating }: { count: number; total: number; rating: number }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-outline w-2">{rating}</span>
    <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
      <div className="h-full bg-yellow-400 rounded-full" style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }} />
    </div>
    <span className="text-xs text-outline w-6 text-right">{count}</span>
  </div>
);

const ProductDetailPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const dispatch = useAppDispatch();
  const { currentProduct: product, isLoading } = useAppSelector((s) => s.products);
  const { isAuthenticated } = useAppSelector((s) => s.auth);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [quantity, setQuantity] = useState(1);
  const [wishlisted, setWishlisted] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [related, setRelated] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<'description' | 'reviews' | 'shipping'>('description');
  const [reviewForm, setReviewForm] = useState({ rating: 0, title: '', body: '', hovered: 0 });
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    if (slug) { dispatch(fetchProduct(slug)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }, [slug, dispatch]);

  useEffect(() => {
    if (product?._id) {
      setReviewsLoading(true);
      api.get(`/products/${product._id}/reviews?limit=10`).then(({ data }) => setReviews(data.data || [])).finally(() => setReviewsLoading(false));
      api.get(`/products/${product._id}/related`).then(({ data }) => setRelated(data.data || []));
    }
  }, [product?._id]);

  const handleAddToCart = async () => {
    if (!isAuthenticated) { toast.error('Please sign in to add items to cart'); return; }
    if (!product) return;
    setAddingToCart(true);
    await dispatch(addToCart({ productId: product._id, quantity, variant: selectedVariant ? { name: selectedVariant.name, value: selectedVariant.value } : undefined }));
    dispatch(openCart());
    setAddingToCart(false);
  };

  const handleWishlist = async () => {
    if (!isAuthenticated) { toast.error('Please sign in'); return; }
    try { await api.post(`/products/${product?._id}/wishlist`); setWishlisted(!wishlisted); toast.success(wishlisted ? 'Removed from wishlist' : 'Saved to wishlist'); } catch { toast.error('Failed'); }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { toast.error('Please sign in to review'); return; }
    if (reviewForm.rating === 0) { toast.error('Please select a rating'); return; }
    setSubmittingReview(true);
    try {
      const { data } = await api.post(`/products/${product?._id}/reviews`, { rating: reviewForm.rating, title: reviewForm.title, body: reviewForm.body });
      setReviews((prev) => [data.data, ...prev]);
      setReviewForm({ rating: 0, title: '', body: '', hovered: 0 });
      toast.success('Review submitted!');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed to submit review'); }
    setSubmittingReview(false);
  };

  if (isLoading || !product) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div className="space-y-4"><div className="aspect-square skeleton rounded-lg" /><div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="aspect-square skeleton rounded-md" />)}</div></div>
          <div className="space-y-4">{[...Array(6)].map((_, i) => <div key={i} className="h-6 skeleton rounded" style={{ width: `${60 + i * 8}%` }} />)}</div>
        </div>
      </div>
    );
  }

  const images = product.images?.length ? product.images : [{ url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800', alt: product.name, isPrimary: true }];
  const currentPrice = product.discountedPrice || product.price;
  // Fallback for when the backend sends a lean() result without the inStock virtual
  const inStock = product.inStock !== undefined
    ? product.inStock
    : (!product.trackInventory || product.stock > 0);
  const discountPct = product.compareAtPrice && product.compareAtPrice > product.price ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100) : 0;
  const seller = product.seller as any;

  return (
    <>
      <Helmet><title>{product.name} | CartLy</title><meta name="description" content={product.shortDescription || product.description?.slice(0, 155)} /></Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <nav className="flex items-center gap-2 text-xs text-outline mb-8">
          <Link to="/" className="hover:text-on-surface">Home</Link><span>/</span>
          <Link to="/products" className="hover:text-on-surface">Products</Link>
          {product.category && <><span>/</span><Link to={`/products?category=${(product.category as any)._id}`} className="hover:text-on-surface capitalize">{(product.category as any).name}</Link></>}
          <span>/</span><span className="text-on-surface truncate max-w-xs">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          {/* Gallery */}
          <div className="space-y-4">
            <div className="relative bg-surface-low rounded-lg overflow-hidden aspect-square group">
              <AnimatePresence mode="wait">
                <motion.img key={activeImage} src={images[activeImage]?.url} alt={images[activeImage]?.alt || product.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="w-full h-full object-cover" />
              </AnimatePresence>
              {images.length > 1 && (<>
                <button onClick={() => setActiveImage((p) => (p - 1 + images.length) % images.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity"><ChevronLeft size={16} /></button>
                <button onClick={() => setActiveImage((p) => (p + 1) % images.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity"><ChevronRight size={16} /></button>
              </>)}
              <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                {discountPct > 0 && <span className="badge badge-error">-{discountPct}%</span>}
                {product.isTrending && <span className="badge badge-primary">Trending</span>}
                {product.isNewArrival && <span className="badge badge-success">New</span>}
              </div>
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {images.map((img, i) => (<button key={i} onClick={() => setActiveImage(i)} className={`aspect-square rounded-md overflow-hidden border-2 transition-colors ${activeImage === i ? 'border-primary-900' : 'border-transparent hover:border-outline-variant'}`}><img src={img.url} alt={img.alt} className="w-full h-full object-cover" /></button>))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              {product.category && <Link to={`/products?category=${(product.category as any)._id}`} className="text-[10px] font-black uppercase tracking-widest text-primary-700 hover:text-primary-900">{(product.category as any).name}</Link>}
              {product.brand && <><span className="text-outline-variant">·</span><span className="text-xs text-outline">{product.brand}</span></>}
            </div>
            <h1 className="font-headline text-3xl lg:text-4xl font-black tracking-tighter text-on-surface leading-tight">{product.name}</h1>
            {product.rating?.count > 0 && (
              <button onClick={() => setActiveTab('reviews')} className="flex items-center gap-2 group">
                <div className="flex">{[1,2,3,4,5].map((s) => <Star key={s} size={14} className={s <= Math.round(product.rating.average) ? 'text-yellow-400 fill-yellow-400' : 'text-outline-variant'} />)}</div>
                <span className="text-sm font-semibold text-on-surface">{product.rating.average.toFixed(1)}</span>
                <span className="text-sm text-outline group-hover:text-primary-700 transition-colors">({product.rating.count} reviews)</span>
              </button>
            )}
            <div className="flex items-baseline gap-3">
              <span className="font-headline text-3xl font-black text-on-surface">${currentPrice.toFixed(2)}</span>
              {product.compareAtPrice && product.compareAtPrice > product.price && <span className="text-lg text-outline line-through">${product.compareAtPrice.toFixed(2)}</span>}
              {discountPct > 0 && <span className="text-sm font-bold text-error">Save {discountPct}%</span>}
            </div>
            {product.shortDescription && <p className="text-on-surface-variant leading-relaxed">{product.shortDescription}</p>}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${product.stock > 10 ? 'bg-success' : product.stock > 0 ? 'bg-warning' : 'bg-error'}`} />
              <span className="text-sm font-medium">{product.stock === 0 ? 'Out of Stock' : product.stock <= 5 ? `Only ${product.stock} left!` : product.stock <= 10 ? `Low stock — ${product.stock} remaining` : 'In Stock'}</span>
            </div>

            {product.hasVariants && product.variants?.length > 0 && (
              <div>
                <p className="label-sm mb-2">{product.variants[0]?.name}{selectedVariant && <span className="normal-case font-normal ml-2 text-on-surface-variant">— {selectedVariant.value}</span>}</p>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button key={v._id} onClick={() => setSelectedVariant(v)} disabled={v.stock === 0} className={`px-4 py-2 text-sm font-medium rounded-md border transition-all ${selectedVariant?._id === v._id ? 'bg-primary-900 text-white border-primary-900' : v.stock === 0 ? 'border-outline-variant/30 text-outline/40 line-through cursor-not-allowed' : 'border-outline-variant hover:border-primary-700 text-on-surface'}`}>{v.value}</button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="label-sm mb-2">Quantity</p>
              <div className="flex items-center border border-outline-variant/40 rounded-md overflow-hidden w-fit">
                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-10 h-10 flex items-center justify-center hover:bg-surface-container transition-colors"><Minus size={14} /></button>
                <span className="w-12 text-center text-sm font-semibold">{quantity}</span>
                <button onClick={() => setQuantity((q) => Math.min(product.stock || 99, q + 1))} className="w-10 h-10 flex items-center justify-center hover:bg-surface-container transition-colors"><Plus size={14} /></button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleAddToCart} disabled={!inStock || addingToCart} className="flex-1 btn-primary py-4 justify-center disabled:opacity-50">
                {addingToCart ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><ShoppingBag size={16} />{inStock ? 'Add to Cart' : 'Out of Stock'}</>}
              </button>
              <button onClick={handleWishlist} className={`w-14 h-14 flex items-center justify-center rounded-md border transition-all ${wishlisted ? 'bg-red-50 border-red-200 text-red-500' : 'border-outline-variant/40 text-on-surface-variant hover:border-red-300 hover:text-red-500'}`}><Heart size={18} className={wishlisted ? 'fill-current' : ''} /></button>
              <button onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success('Link copied!'); }} className="w-14 h-14 flex items-center justify-center rounded-md border border-outline-variant/40 text-on-surface-variant hover:border-primary-700 hover:text-primary-700 transition-all"><Share2 size={18} /></button>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-outline-variant/20">
              {[{ icon: Truck, label: product.shipping?.isFreeShipping ? 'Free Shipping' : 'Fast Shipping', sub: 'Orders over $100' }, { icon: Shield, label: 'Secure Payment', sub: 'SSL encrypted' }, { icon: RotateCcw, label: '30-Day Returns', sub: 'Easy returns' }].map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex flex-col items-center text-center gap-1 p-3 rounded-md bg-surface-low">
                  <Icon size={16} className="text-primary-700" /><span className="text-xs font-semibold text-on-surface">{label}</span><span className="text-[10px] text-outline">{sub}</span>
                </div>
              ))}
            </div>

            {seller && (
              <div className="flex items-center gap-3 p-4 border border-outline-variant/20 rounded-md">
                <div className="w-10 h-10 rounded-full editorial-gradient flex items-center justify-center flex-shrink-0"><Store size={16} className="text-white" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{seller.sellerProfile?.storeName || seller.name}</p>
                  <p className="text-xs text-outline">{seller.sellerProfile?.totalSales || 0} sales</p>
                </div>
                {seller.sellerProfile?.storeSlug && <Link to={`/store/${seller.sellerProfile.storeSlug}`} className="btn-ghost text-xs">Visit Store</Link>}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-16">
          <div className="flex gap-1 border-b border-outline-variant/20 mb-8">
            {(['description', 'reviews', 'shipping'] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-3 text-xs font-black uppercase tracking-widest capitalize border-b-2 -mb-px transition-colors ${activeTab === tab ? 'border-primary-900 text-primary-900' : 'border-transparent text-outline hover:text-on-surface'}`}>
                {tab}{tab === 'reviews' && product.rating?.count > 0 && <span className="ml-2 badge badge-neutral">{product.rating.count}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'description' && (
            <div className="max-w-3xl">
              <p className="text-on-surface-variant leading-relaxed whitespace-pre-line">{product.description}</p>
              {product.tags?.length > 0 && <div className="flex flex-wrap gap-2 mt-8">{product.tags.map((tag) => <Link key={tag} to={`/products?tags=${tag}`} className="px-3 py-1.5 bg-surface-container text-xs text-on-surface-variant rounded-full hover:bg-primary-50 hover:text-primary-900 transition-colors">#{tag}</Link>)}</div>}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="max-w-3xl space-y-8">
              {product.rating?.count > 0 && (
                <div className="flex gap-8 p-6 bg-surface-low rounded-lg">
                  <div className="text-center">
                    <p className="font-headline text-5xl font-black text-on-surface">{product.rating.average.toFixed(1)}</p>
                    <div className="flex justify-center my-2">{[1,2,3,4,5].map((s) => <Star key={s} size={14} className={s <= Math.round(product.rating.average) ? 'text-yellow-400 fill-yellow-400' : 'text-outline-variant'} />)}</div>
                    <p className="text-xs text-outline">{product.rating.count} reviews</p>
                  </div>
                  <div className="flex-1 space-y-1.5">{[5,4,3,2,1].map((r) => <StarBar key={r} rating={r} count={product.rating.distribution?.[r] || 0} total={product.rating.count} />)}</div>
                </div>
              )}
              {isAuthenticated && (
                <div className="border border-outline-variant/20 rounded-lg p-6">
                  <h3 className="font-headline font-black text-sm uppercase tracking-wider mb-4">Write a Review</h3>
                  <form onSubmit={handleSubmitReview} className="space-y-4">
                    <div>
                      <p className="label-sm mb-2">Your Rating</p>
                      <div className="flex gap-1">{[1,2,3,4,5].map((s) => <button key={s} type="button" onMouseEnter={() => setReviewForm((f) => ({ ...f, hovered: s }))} onMouseLeave={() => setReviewForm((f) => ({ ...f, hovered: 0 }))} onClick={() => setReviewForm((f) => ({ ...f, rating: s }))}><Star size={24} className={`transition-colors ${s <= (reviewForm.hovered || reviewForm.rating) ? 'text-yellow-400 fill-yellow-400' : 'text-outline-variant'}`} /></button>)}</div>
                    </div>
                    <div><label className="label-sm block mb-1.5">Title</label><input value={reviewForm.title} onChange={(e) => setReviewForm((f) => ({ ...f, title: e.target.value }))} placeholder="Summarize your experience" className="input-box text-sm" /></div>
                    <div><label className="label-sm block mb-1.5">Review</label><textarea value={reviewForm.body} onChange={(e) => setReviewForm((f) => ({ ...f, body: e.target.value }))} rows={4} placeholder="Share details about your experience..." className="input-box text-sm resize-none" /></div>
                    <button type="submit" disabled={submittingReview} className="btn-primary text-xs">{submittingReview ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><MessageSquare size={14} /> Submit Review</>}</button>
                  </form>
                </div>
              )}
              {reviewsLoading ? <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-24 skeleton rounded-lg" />)}</div>
                : reviews.length === 0 ? <p className="text-outline text-sm text-center py-8">No reviews yet. Be the first!</p>
                : <div className="space-y-5">{reviews.map((review) => (
                  <div key={review._id} className="border-b border-outline-variant/10 pb-5 last:border-0">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full editorial-gradient flex items-center justify-center flex-shrink-0"><span className="text-white text-xs font-bold">{review.user.name[0]?.toUpperCase()}</span></div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2"><span className="text-sm font-semibold text-on-surface">{review.user.name}</span>{review.isVerifiedPurchase && <span className="flex items-center gap-1 text-[10px] font-semibold text-success"><Check size={10} /> Verified</span>}</div>
                          <span className="text-xs text-outline">{new Date(review.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="flex my-1">{[1,2,3,4,5].map((s) => <Star key={s} size={12} className={s <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-outline-variant'} />)}</div>
                        {review.title && <p className="text-sm font-semibold text-on-surface mb-1">{review.title}</p>}
                        {review.body && <p className="text-sm text-on-surface-variant leading-relaxed">{review.body}</p>}
                        <button className="flex items-center gap-1 mt-2 text-xs text-outline hover:text-on-surface transition-colors"><ThumbsUp size={11} /> Helpful ({review.helpfulVotes})</button>
                      </div>
                    </div>
                  </div>
                ))}</div>
              }
            </div>
          )}

          {activeTab === 'shipping' && (
            <div className="max-w-2xl space-y-4">
              {[{ icon: Truck, title: 'Delivery', body: product.shipping?.isFreeShipping ? 'Free standard shipping on this item. Express available at checkout.' : 'Standard: $9.99. Free on orders over $100. Express available.' }, { icon: Package, title: 'Packaging', body: 'All items are carefully packaged. Gift wrapping available at checkout.' }, { icon: RotateCcw, title: 'Returns', body: '30-day return policy. Items must be in original condition. Return shipping free for defective items.' }, { icon: Shield, title: 'Buyer Protection', body: "All purchases are protected by our Buyer Guarantee. If your item doesn't arrive or doesn't match the description, we'll make it right." }].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4 p-4 border border-outline-variant/20 rounded-lg">
                  <div className="w-10 h-10 rounded-md bg-primary-50 flex items-center justify-center flex-shrink-0"><Icon size={18} className="text-primary-700" /></div>
                  <div><h4 className="font-semibold text-sm text-on-surface mb-1">{title}</h4><p className="text-sm text-on-surface-variant leading-relaxed">{body}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {related.length > 0 && (
          <div>
            <div className="mb-8"><p className="section-label mb-2">You may also like</p><h2 className="font-headline text-3xl font-black tracking-tighter">Related Products</h2></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">{related.map((p) => <ProductCard key={p._id} product={p} />)}</div>
          </div>
        )}
      </div>
    </>
  );
};

export default ProductDetailPage;
