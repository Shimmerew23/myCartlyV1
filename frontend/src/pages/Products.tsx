import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, X, ChevronDown, Search, Grid2X2, LayoutList } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { fetchProducts } from '@/store/slices/productSlice';
import ProductCard from '@/components/products/ProductCard';
import { Helmet } from 'react-helmet-async';
import api from '@/api/axios';
import { Category } from '@/types';
import { findClosestMatch } from '@/utils/fuzzy';

const SORT_OPTIONS = [
  { label: 'Newest', value: '-createdAt' },
  { label: 'Oldest', value: 'createdAt' },
  { label: 'Price: Low to High', value: 'price' },
  { label: 'Price: High to Low', value: '-price' },
  { label: 'Top Rated', value: '-rating' },
  { label: 'Best Selling', value: '-sales' },
];

const ProductsPage = () => {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { products, pagination, isLoading } = useAppSelector((s) => s.products);

  const [categories, setCategories] = useState<Category[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const productNamesCache = useRef<string[]>([]);
  const [gridView, setGridView] = useState<'grid' | 'list'>('grid');
  const [localFilters, setLocalFilters] = useState({
    search: searchParams.get('search') || '',
    category: searchParams.get('category') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    rating: searchParams.get('rating') || '',
    inStock: searchParams.get('inStock') === 'true',
    sort: searchParams.get('sort') || '-createdAt',
    trending: searchParams.get('trending') === 'true',
    featured: searchParams.get('featured') === 'true',
    newArrival: searchParams.get('newArrival') === 'true',
  });

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(data.data)).catch(() => {});
  }, []);

  const applyFilters = useCallback((f = localFilters, page = 1) => {
    const active: Record<string, string> = { page: String(page) };
    Object.entries(f).forEach(([k, v]) => {
      if (v !== '' && v !== false && v !== undefined) active[k] = String(v);
    });
    setSearchParams(active);
    // Do NOT dispatch here — the searchParams useEffect is the single place
    // that triggers fetches, preventing the duplicate request.
  }, [localFilters, setSearchParams]);

  // Single source of truth: re-sync local filters and fetch whenever the URL
  // changes. Covers both user-driven filter changes and external nav links
  // (Shop / New Arrivals / Trending) that push new query params.
  useEffect(() => {
    const page = Number(searchParams.get('page') || 1);
    const synced = {
      search: searchParams.get('search') || '',
      category: searchParams.get('category') || '',
      minPrice: searchParams.get('minPrice') || '',
      maxPrice: searchParams.get('maxPrice') || '',
      rating: searchParams.get('rating') || '',
      inStock: searchParams.get('inStock') === 'true',
      sort: searchParams.get('sort') || '-createdAt',
      trending: searchParams.get('trending') === 'true',
      featured: searchParams.get('featured') === 'true',
      newArrival: searchParams.get('newArrival') === 'true',
    };
    setLocalFilters(synced);
    const params: Record<string, any> = { page };
    Object.entries(synced).forEach(([k, v]) => { if (v !== '' && v !== false) params[k] = v; });
    dispatch(fetchProducts(params as any));
  }, [searchParams]);

  useEffect(() => {
    if (!isLoading && products.length === 0 && localFilters.search) {
      (async () => {
        if (productNamesCache.current.length === 0) {
          try {
            const { data } = await api.get('/products', { params: { limit: 100 } });
            productNamesCache.current = (data.data || []).map((p: any) => p.name);
          } catch {}
        }
        setSuggestion(findClosestMatch(localFilters.search, productNamesCache.current));
      })();
    } else {
      setSuggestion(null);
    }
  }, [isLoading, products.length, localFilters.search]);

  const handleFilterChange = (key: string, value: any) => {
    const updated = { ...localFilters, [key]: value };
    setLocalFilters(updated);
  };

  const handleApply = () => { applyFilters(localFilters, 1); setFiltersOpen(false); };
  const handleReset = () => {
    const reset = { search: '', category: '', minPrice: '', maxPrice: '', rating: '', inStock: false, sort: '-createdAt', trending: false, featured: false, newArrival: false };
    setLocalFilters(reset);
    applyFilters(reset, 1);
  };

  const activeFilterCount = Object.entries(localFilters).filter(([k, v]) =>
    k !== 'sort' && v !== '' && v !== false
  ).length;

  return (
    <>
      <Helmet><title>Products | CartLy</title></Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-headline text-3xl font-black tracking-tighter text-on-surface">All Products</h1>
            <p className="text-sm text-outline mt-1">
              {isLoading ? 'Loading...' : `${pagination.total.toLocaleString()} products`}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={localFilters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
                placeholder="Search products..."
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-outline-variant/30 rounded-md focus:outline-none focus:border-primary-700 focus:ring-1 focus:ring-primary-700/10 transition-all"
              />
            </div>

            {/* Sort */}
            <div className="relative">
              <select
                value={localFilters.sort}
                onChange={(e) => { handleFilterChange('sort', e.target.value); applyFilters({ ...localFilters, sort: e.target.value }, 1); }}
                className="appearance-none pl-3 pr-8 py-2.5 text-sm bg-white border border-outline-variant/30 rounded-md focus:outline-none focus:border-primary-700 transition-all cursor-pointer"
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
            </div>

            {/* Filter button */}
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm font-medium transition-all ${
                activeFilterCount > 0
                  ? 'bg-primary-900 text-white border-primary-900'
                  : 'bg-white border-outline-variant/30 text-on-surface-variant hover:border-outline-variant'
              }`}
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-white/20 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Grid toggle */}
            <div className="hidden sm:flex border border-outline-variant/30 rounded-md overflow-hidden">
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setGridView(v)}
                  className={`p-2.5 transition-colors ${gridView === v ? 'bg-primary-900 text-white' : 'bg-white text-outline hover:bg-surface-low'}`}
                >
                  {v === 'grid' ? <Grid2X2 size={15} /> : <LayoutList size={15} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Panel */}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="bg-white border border-outline-variant/20 rounded-lg p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Category */}
                  <div>
                    <label className="label-sm block mb-2">Category</label>
                    <select
                      value={localFilters.category}
                      onChange={(e) => handleFilterChange('category', e.target.value)}
                      className="input-box text-sm"
                    >
                      <option value="">All Categories</option>
                      {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Price Range */}
                  <div>
                    <label className="label-sm block mb-2">Price Range</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={localFilters.minPrice}
                        onChange={(e) => handleFilterChange('minPrice', e.target.value)}
                        placeholder="Min"
                        className="input-box text-sm w-full"
                        min="0"
                      />
                      <input
                        type="number"
                        value={localFilters.maxPrice}
                        onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
                        placeholder="Max"
                        className="input-box text-sm w-full"
                        min="0"
                      />
                    </div>
                  </div>

                  {/* Min Rating */}
                  <div>
                    <label className="label-sm block mb-2">Minimum Rating</label>
                    <select
                      value={localFilters.rating}
                      onChange={(e) => handleFilterChange('rating', e.target.value)}
                      className="input-box text-sm"
                    >
                      <option value="">Any Rating</option>
                      {[4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}+ Stars</option>)}
                    </select>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3">
                    <label className="label-sm block mb-2">Filters</label>
                    {[
                      { key: 'inStock', label: 'In Stock Only' },
                      { key: 'featured', label: 'Featured' },
                      { key: 'trending', label: 'Trending' },
                      { key: 'newArrival', label: 'New Arrivals' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(localFilters as any)[key]}
                          onChange={(e) => handleFilterChange(key, e.target.checked)}
                          className="w-3.5 h-3.5 accent-primary-900"
                        />
                        <span className="text-sm text-on-surface-variant">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-6 pt-4 border-t border-outline-variant/10">
                  <button onClick={handleApply} className="btn-primary text-xs">Apply Filters</button>
                  <button onClick={handleReset} className="btn-ghost text-xs flex items-center gap-1">
                    <X size={13} /> Reset All
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Products Grid */}
        {isLoading ? (
          <div className={`grid gap-6 ${gridView === 'grid' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1'}`}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] skeleton rounded-lg" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mx-auto mb-4">
              <Search size={24} className="text-outline" />
            </div>
            <h3 className="font-headline text-xl font-bold text-on-surface mb-2">No products found</h3>
            <p className="text-sm text-outline mb-3">Try adjusting your filters or search terms</p>
            {suggestion && (
              <button
                onClick={() => {
                  const updated = { ...localFilters, search: suggestion };
                  setLocalFilters(updated);
                  applyFilters(updated, 1);
                  setSuggestion(null);
                }}
                className="text-sm font-semibold text-primary-700 hover:text-primary-900 mb-4 block mx-auto"
              >
                Did you mean "<span className="underline">{suggestion}</span>"?
              </button>
            )}
            <button onClick={handleReset} className="btn-secondary text-xs">Clear Filters</button>
          </div>
        ) : (
          <div className={`grid gap-6 ${gridView === 'grid' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {products.map((product) => (
              <ProductCard key={product._id} product={product} variant={gridView === 'list' ? 'horizontal' : 'default'} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-12">
            <button
              onClick={() => applyFilters(localFilters, pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn-ghost text-xs disabled:opacity-40"
            >← Prev</button>

            {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => applyFilters(localFilters, page)}
                  className={`w-9 h-9 rounded-md text-sm font-medium transition-colors ${
                    page === pagination.page
                      ? 'bg-primary-900 text-white'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {page}
                </button>
              );
            })}

            <button
              onClick={() => applyFilters(localFilters, pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="btn-ghost text-xs disabled:opacity-40"
            >Next →</button>
          </div>
        )}
      </div>
    </>
  );
};

export default ProductsPage;
