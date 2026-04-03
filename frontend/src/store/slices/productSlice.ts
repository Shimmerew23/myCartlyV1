import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import api from '@/api/axios';
import { Product, ProductFilters } from '@/types';

interface ProductState {
  products: Product[];
  featured: Product[];
  trending: Product[];
  newArrivals: Product[];
  currentProduct: Product | null;
  filters: ProductFilters;
  pagination: { page: number; limit: number; total: number; pages: number; };
  isLoading: boolean;
  error: string | null;
}

const initial: ProductState = {
  products: [],
  featured: [],
  trending: [],
  newArrivals: [],
  currentProduct: null,
  filters: { page: 1, limit: 20, sort: '-createdAt' },
  pagination: { page: 1, limit: 20, total: 0, pages: 0 },
  isLoading: false,
  error: null,
};

export const fetchProducts = createAsyncThunk(
  'products/fetchAll',
  async (filters: ProductFilters, { rejectWithValue }) => {
    try {
      const params = Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== '')
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
      const { data } = await api.get('/products', { params });
      return data;
    } catch (err: any) {
      return rejectWithValue(err.message);
    }
  }
);

export const fetchFeatured = createAsyncThunk('products/featured', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/products/featured');
    return data.data;
  } catch (err: any) { return rejectWithValue(err.message); }
});

export const fetchProduct = createAsyncThunk(
  'products/fetchOne',
  async (slug: string, { rejectWithValue }) => {
    try {
      const { data } = await api.get(`/products/${slug}`);
      return data.data;
    } catch (err: any) { return rejectWithValue(err.message); }
  }
);

const productSlice = createSlice({
  name: 'products',
  initialState: initial,
  reducers: {
    setFilters: (state, action: PayloadAction<Partial<ProductFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => { state.filters = initial.filters; },
    clearCurrentProduct: (state) => { state.currentProduct = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProducts.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(fetchProducts.fulfilled, (state, action: any) => {
        state.isLoading = false;
        state.products = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    builder.addCase(fetchFeatured.fulfilled, (state, action: any) => {
      state.featured = action.payload.featured || [];
      state.trending = action.payload.trending || [];
      state.newArrivals = action.payload.newArrivals || [];
    });

    builder
      .addCase(fetchProduct.pending, (state) => { state.isLoading = true; })
      .addCase(fetchProduct.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentProduct = action.payload;
      })
      .addCase(fetchProduct.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });
  },
});

export const { setFilters, clearFilters, clearCurrentProduct } = productSlice.actions;
export default productSlice.reducer;
