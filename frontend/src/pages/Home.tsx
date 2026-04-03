import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, Sparkles, Star } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { fetchFeatured } from '@/store/slices/productSlice';
import ProductCard from '@/components/products/ProductCard';
import { Helmet } from 'react-helmet-async';

const HERO_IMG = 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1600&q=80';

const HomePage = () => {
  const dispatch = useAppDispatch();
  const { featured, trending, newArrivals } = useAppSelector((s) => s.products);

  useEffect(() => { dispatch(fetchFeatured()); }, [dispatch]);

  const stagger = {
    container: { hidden: {}, visible: { transition: { staggerChildren: 0.1 } } },
    item: { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } },
  };

  return (
    <>
      <Helmet>
        <title>CartLy | Premium eCommerce</title>
        <meta name="description" content="Discover curated products from independent sellers worldwide." />
      </Helmet>

      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden bg-on-surface">
        <div className="absolute inset-0">
          <img src={HERO_IMG} alt="Hero" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-r from-on-surface via-on-surface/80 to-transparent" />
        </div>
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="max-w-2xl"
          >
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="section-label text-white/60 mb-6"
            >
              New Season 2025
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7 }}
              className="font-headline text-6xl sm:text-7xl lg:text-8xl font-black text-white tracking-tighter leading-none mb-6"
            >
              Curated<br />
              <span className="text-primary-300">Excellence</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-white/60 text-lg max-w-lg leading-relaxed mb-10"
            >
              Discover exceptional products from independent sellers — each piece selected for its quality, craftsmanship, and story.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-wrap items-center gap-4"
            >
              <Link to="/products" className="btn-primary text-sm py-4 px-8">
                Explore Collection <ArrowRight size={16} />
              </Link>
              <Link to="/products?featured=true" className="text-white/70 text-sm font-semibold hover:text-white transition-colors flex items-center gap-2">
                Featured Picks <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-px h-12 bg-gradient-to-b from-white/40 to-transparent" />
        </div>
      </section>

      {/* Stats Banner */}
      <section className="bg-white border-y border-outline-variant/20 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-outline-variant/20">
            {[
              { value: '50K+', label: 'Products' },
              { value: '12K+', label: 'Sellers' },
              { value: '4.9★', label: 'Rating' },
              { value: '180+', label: 'Countries' },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col items-center py-2 px-4">
                <span className="font-headline text-2xl font-black text-on-surface">{stat.value}</span>
                <span className="text-xs text-outline uppercase tracking-widest mt-0.5">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      {featured.length > 0 && (
        <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="section-label mb-3"><Sparkles size={12} /> Featured</p>
              <h2 className="font-headline text-4xl font-black tracking-tighter text-on-surface">Editor's Picks</h2>
            </div>
            <Link to="/products?featured=true" className="btn-ghost text-xs hidden sm:flex">
              View All <ArrowRight size={14} />
            </Link>
          </div>
          <motion.div
            variants={stagger.container}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6"
          >
            {featured.slice(0, 8).map((product) => (
              <motion.div key={product._id} variants={stagger.item}>
                <ProductCard product={product} />
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* Trending Section */}
      {trending.length > 0 && (
        <section className="py-20 bg-surface-low">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between mb-10">
              <div>
                <p className="section-label mb-3"><TrendingUp size={12} /> Trending</p>
                <h2 className="font-headline text-4xl font-black tracking-tighter text-on-surface">Most Popular</h2>
              </div>
              <Link to="/products?trending=true" className="btn-ghost text-xs hidden sm:flex">
                View All <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
              {trending.slice(0, 12).map((product) => (
                <ProductCard key={product._id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Become a Seller CTA */}
      <section className="py-24 editorial-gradient relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          <p className="section-label justify-center text-white/50 mb-6">For Creators</p>
          <h2 className="font-headline text-5xl lg:text-6xl font-black text-white tracking-tighter mb-6">
            Start Selling Today
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            Join thousands of independent sellers on CartLy. List your products, reach global customers, and grow your business.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/become-seller" className="bg-white text-primary-900 font-headline text-xs font-bold uppercase tracking-widest px-8 py-4 rounded-md hover:bg-primary-50 transition-colors">
              Become a Seller
            </Link>
            <Link to="/products" className="text-white/70 text-sm font-semibold hover:text-white transition-colors">
              Buy →
            </Link>
          </div>
        </div>
      </section>

      {/* New Arrivals */}
      {newArrivals.length > 0 && (
        <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="section-label mb-3"><Star size={12} /> Fresh In</p>
              <h2 className="font-headline text-4xl font-black tracking-tighter text-on-surface">New Arrivals</h2>
            </div>
            <Link to="/products?newArrival=true" className="btn-ghost text-xs hidden sm:flex">
              View All <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {newArrivals.slice(0, 8).map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        </section>
      )}
    </>
  );
};

export default HomePage;
