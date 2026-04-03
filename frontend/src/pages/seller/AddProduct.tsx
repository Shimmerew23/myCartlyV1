import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Plus, Save, ArrowLeft, Image } from 'lucide-react';
import api from '@/api/axios';
import { Category } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const schema = z.object({
  name: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  shortDescription: z.string().max(300).optional(),
  price: z.coerce.number().min(0.01),
  compareAtPrice: z.coerce.number().min(0).optional(),
  category: z.string().min(1, 'Category is required'),
  brand: z.string().optional(),
  sku: z.string().optional(),
  stock: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'active', 'inactive']).default('draft'),
  isFeatured: z.boolean().default(false),
  isTrending: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  tags: z.string().optional(),
  weight: z.coerce.number().optional(),
  isFreeShipping: z.boolean().default(false),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const AddProductPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [categories, setCategories] = useState<Category[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'inventory' | 'shipping' | 'seo'>('basic');

  const { register, handleSubmit, reset, formState: { errors }, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'draft', stock: 0, isFreeShipping: false, isFeatured: false, isTrending: false, isNewArrival: false },
  });

  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => setCategories(data.data || []))
      .catch(() => toast.error('Failed to load categories. Please refresh.'));
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      api.get(`/products/${id}`).then(({ data }) => {
        const p = data.data;
        reset({
          name: p.name, description: p.description, shortDescription: p.shortDescription,
          price: p.price, compareAtPrice: p.compareAtPrice, category: p.category?._id || p.category,
          brand: p.brand, sku: p.sku, stock: p.stock, status: p.status,
          isFeatured: p.isFeatured, isTrending: p.isTrending, isNewArrival: p.isNewArrival,
          tags: p.tags?.join(', '), weight: p.shipping?.weight, isFreeShipping: p.shipping?.isFreeShipping,
          metaTitle: p.seo?.metaTitle, metaDescription: p.seo?.metaDescription,
        });
        setExistingImages(p.images || []);
      });
    }
  }, [id, isEdit, reset]);

  const onDrop = useCallback((accepted: File[]) => {
    setImages((prev) => [...prev, ...accepted].slice(0, 10));
    setImagePreviews((prev) => [
      ...prev,
      ...accepted.map((f) => URL.createObjectURL(f)),
    ].slice(0, 10));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxFiles: 10,
    maxSize: 10 * 1024 * 1024,
  });

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([k, v]) => {
        if (v !== undefined && v !== '') formData.append(k, String(v));
      });
      images.forEach((img) => formData.append('images', img));

      if (isEdit) {
        await api.put(`/products/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Product updated!');
      } else {
        await api.post('/products', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Product created!');
      }
      navigate('/seller/products');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save product');
    }
    setSubmitting(false);
  };

  const TABS = ['basic', 'inventory', 'shipping', 'seo'] as const;

  return (
    <>
      <Helmet><title>{isEdit ? 'Edit' : 'Add'} Product | Seller</title></Helmet>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/seller/products')} className="btn-ghost text-xs">
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">
              {isEdit ? 'Edit Product' : 'Add New Product'}
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-outline-variant/20">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-bold uppercase tracking-widest capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'border-primary-900 text-primary-900'
                    : 'border-transparent text-outline hover:text-on-surface'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              {/* Images */}
              <div className="card p-6">
                <h3 className="font-headline font-bold text-sm mb-4">Product Images</h3>
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragActive ? 'border-primary-700 bg-primary-50' : 'border-outline-variant/40 hover:border-primary-700 hover:bg-surface-low'
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload size={24} className="text-outline mx-auto mb-3" />
                  <p className="text-sm font-medium text-on-surface-variant">
                    {isDragActive ? 'Drop images here' : 'Drag & drop or click to upload'}
                  </p>
                  <p className="text-xs text-outline mt-1">JPG, PNG, WebP — max 10MB each, up to 10 images</p>
                </div>

                {(imagePreviews.length > 0 || existingImages.length > 0) && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 mt-4">
                    {existingImages.map((img, i) => (
                      <div key={`existing-${i}`} className="relative aspect-square rounded-md overflow-hidden bg-surface-low group">
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                        {img.isPrimary && <span className="absolute top-1 left-1 badge badge-primary text-[8px]">Primary</span>}
                      </div>
                    ))}
                    {imagePreviews.map((preview, i) => (
                      <div key={`new-${i}`} className="relative aspect-square rounded-md overflow-hidden bg-surface-low group">
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute top-1 right-1 w-5 h-5 bg-error rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={10} className="text-white" />
                        </button>
                        {i === 0 && existingImages.length === 0 && (
                          <span className="absolute bottom-1 left-1 badge badge-primary text-[8px]">Primary</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Core Fields */}
              <div className="card p-6 space-y-5">
                <h3 className="font-headline font-bold text-sm">Product Details</h3>
                <div>
                  <label className="label-sm block mb-1.5">Product Name *</label>
                  <input {...register('name')} className="input-box" placeholder="e.g. Premium Leather Wallet" />
                  {errors.name && <p className="text-xs text-error mt-1">{errors.name.message}</p>}
                </div>

                <div>
                  <label className="label-sm block mb-1.5">Short Description</label>
                  <input {...register('shortDescription')} className="input-box" placeholder="Brief one-liner for product cards" />
                </div>

                <div>
                  <label className="label-sm block mb-1.5">Full Description *</label>
                  <textarea {...register('description')} rows={6} className="input-box resize-none" placeholder="Detailed product description..." />
                  {errors.description && <p className="text-xs text-error mt-1">{errors.description.message}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-sm block mb-1.5">Category *</label>
                    <select {...register('category')} className="input-box">
                      <option value="">Select category</option>
                      {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    {errors.category && <p className="text-xs text-error mt-1">{errors.category.message}</p>}
                  </div>
                  <div>
                    <label className="label-sm block mb-1.5">Brand</label>
                    <input {...register('brand')} className="input-box" placeholder="Brand name" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-sm block mb-1.5">Price (USD) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-outline">$</span>
                      <input {...register('price')} type="number" step="0.01" min="0" className="input-box pl-7" placeholder="0.00" />
                    </div>
                    {errors.price && <p className="text-xs text-error mt-1">{errors.price.message}</p>}
                  </div>
                  <div>
                    <label className="label-sm block mb-1.5">Compare At Price</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-outline">$</span>
                      <input {...register('compareAtPrice')} type="number" step="0.01" min="0" className="input-box pl-7" placeholder="Original price" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="label-sm block mb-1.5">Tags (comma separated)</label>
                  <input {...register('tags')} className="input-box" placeholder="leather, wallet, accessories" />
                </div>

                <div>
                  <label className="label-sm block mb-1.5">Status</label>
                  <select {...register('status')} className="input-box">
                    <option value="draft">Draft (not visible)</option>
                    <option value="active">Active (visible to buyers)</option>
                    <option value="inactive">Inactive (hidden)</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {[
                    { key: 'isFeatured', label: 'Featured' },
                    { key: 'isTrending', label: 'Trending' },
                    { key: 'isNewArrival', label: 'New Arrival' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input {...register(key as any)} type="checkbox" className="w-3.5 h-3.5 accent-primary-900" />
                      <span className="text-sm text-on-surface-variant">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Inventory Tab */}
          {activeTab === 'inventory' && (
            <div className="card p-6 space-y-5">
              <h3 className="font-headline font-bold text-sm">Inventory</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-sm block mb-1.5">SKU</label>
                  <input {...register('sku')} className="input-box" placeholder="Auto-generated if empty" />
                </div>
                <div>
                  <label className="label-sm block mb-1.5">Stock Quantity</label>
                  <input {...register('stock')} type="number" min="0" className="input-box" placeholder="0" />
                </div>
              </div>
            </div>
          )}

          {/* Shipping Tab */}
          {activeTab === 'shipping' && (
            <div className="card p-6 space-y-5">
              <h3 className="font-headline font-bold text-sm">Shipping</h3>
              <div>
                <label className="label-sm block mb-1.5">Weight (grams)</label>
                <input {...register('weight')} type="number" min="0" className="input-box" placeholder="e.g. 250" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input {...register('isFreeShipping')} type="checkbox" className="w-3.5 h-3.5 accent-primary-900" />
                <span className="text-sm text-on-surface">Free shipping on this product</span>
              </label>
            </div>
          )}

          {/* SEO Tab */}
          {activeTab === 'seo' && (
            <div className="card p-6 space-y-5">
              <h3 className="font-headline font-bold text-sm">SEO Settings</h3>
              <div>
                <label className="label-sm block mb-1.5">Meta Title</label>
                <input {...register('metaTitle')} className="input-box" placeholder="SEO page title" />
              </div>
              <div>
                <label className="label-sm block mb-1.5">Meta Description</label>
                <textarea {...register('metaDescription')} rows={3} className="input-box resize-none" placeholder="SEO description (150-160 chars)" />
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <><Save size={15} /> {isEdit ? 'Update Product' : 'Create Product'}</>
              )}
            </button>
            <button type="button" onClick={() => navigate('/seller/products')} className="btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default AddProductPage;
export const EditProductPage = AddProductPage;
