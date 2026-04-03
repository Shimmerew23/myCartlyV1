import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Star, Package, Calendar, Store as StoreIcon } from 'lucide-react';
import api from '@/api/axios';
import ProductCard from '@/components/products/ProductCard';
import { Product } from '@/types';
import { Helmet } from 'react-helmet-async';

const StorePage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<{ seller: any; products: Product[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/users/store/${slug}`).then(({ data: res }) => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-10 space-y-4"><div className="h-48 skeleton rounded-lg" /><div className="grid grid-cols-4 gap-6">{[...Array(8)].map((_, i) => <div key={i} className="aspect-[4/5] skeleton rounded-lg" />)}</div></div>;
  if (!data) return <div className="text-center py-20"><p className="text-outline">Store not found</p><Link to="/products" className="btn-primary mt-4">Browse Products</Link></div>;

  const { seller, products } = data;
  const profile = seller.sellerProfile;

  return (
    <>
      <Helmet><title>{profile?.storeName || seller.name} | CartLy</title></Helmet>
      {/* Store Banner */}
      <div className="editorial-gradient relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="relative z-10 max-w-6xl mx-auto px-4 py-16 flex items-end gap-6">
          <div className="w-20 h-20 rounded-full bg-white/20 border-4 border-white/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {profile?.storeLogo ? <img src={profile.storeLogo} alt={profile.storeName} className="w-full h-full object-cover" /> : <StoreIcon size={28} className="text-white" />}
          </div>
          <div className="text-white">
            <h1 className="font-headline text-3xl font-black tracking-tighter">{profile?.storeName || seller.name}</h1>
            {profile?.storeBio && <p className="text-white/70 text-sm mt-1 max-w-lg">{profile.storeBio}</p>}
            <div className="flex items-center gap-4 mt-3 text-white/60 text-xs">
              <span className="flex items-center gap-1.5"><Package size={12} /> {products.length} products</span>
              <span className="flex items-center gap-1.5"><Package size={12} /> {profile?.totalSales || 0} sales</span>
              <span className="flex items-center gap-1.5"><Calendar size={12} /> Member since {new Date(seller.createdAt).getFullYear()}</span>
              {profile?.rating > 0 && <span className="flex items-center gap-1.5"><Star size={12} className="fill-yellow-300 text-yellow-300" /> {profile.rating.toFixed(1)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10">
        {products.length === 0 ? (
          <div className="text-center py-16"><Package size={40} className="text-outline mx-auto mb-3" /><p className="text-outline">No products listed yet</p></div>
        ) : (
          <>
            <h2 className="font-headline font-black text-xl mb-6">All Products ({products.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {products.map((p) => <ProductCard key={p._id} product={p} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default StorePage;
