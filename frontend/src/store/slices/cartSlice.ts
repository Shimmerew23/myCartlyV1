// ============================================================
// CART SLICE
// ============================================================
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import api from '@/api/axios';
import { Cart, CartItem } from '@/types';
import toast from 'react-hot-toast';

interface CartState extends Cart {
  isLoading: boolean;
  isOpen: boolean;
  selectedItemIds: string[];
}

const initialCartState: CartState = {
  items: [],
  subtotal: 0,
  itemCount: 0,
  isLoading: false,
  isOpen: false,
  selectedItemIds: [],
};

export const fetchCart = createAsyncThunk('cart/fetch', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/cart');
    return data.data;
  } catch (err: any) {
    return rejectWithValue(err.message);
  }
});

export const addToCart = createAsyncThunk(
  'cart/addItem',
  async (
    payload: { productId: string; quantity: number; variant?: { name: string; value: string } },
    { rejectWithValue }
  ) => {
    try {
      const { data } = await api.post('/cart/add', payload);
      toast.success('Added to cart!');
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to cart');
      return rejectWithValue(err.message);
    }
  }
);

export const updateCartItem = createAsyncThunk(
  'cart/updateItem',
  async ({ itemId, quantity }: { itemId: string; quantity: number }, { rejectWithValue }) => {
    try {
      const { data } = await api.put(`/cart/items/${itemId}`, { quantity });
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
      return rejectWithValue(err.message);
    }
  }
);

export const removeFromCart = createAsyncThunk(
  'cart/removeItem',
  async (itemId: string, { rejectWithValue }) => {
    try {
      const { data } = await api.delete(`/cart/items/${itemId}`);
      toast.success('Item removed');
      return data.data;
    } catch (err: any) {
      return rejectWithValue(err.message);
    }
  }
);

export const clearCart = createAsyncThunk('cart/clear', async (_, { rejectWithValue }) => {
  try {
    await api.delete('/cart');
    return null;
  } catch (err: any) {
    return rejectWithValue(err.message);
  }
});

export const applyCoupon = createAsyncThunk(
  'cart/applyCoupon',
  async (code: string, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/cart/coupon', { code });
      toast.success('Coupon applied!');
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Invalid coupon');
      return rejectWithValue(err.message);
    }
  }
);

const cartSlice = createSlice({
  name: 'cart',
  initialState: initialCartState,
  reducers: {
    toggleCart: (state) => { state.isOpen = !state.isOpen; },
    openCart: (state) => { state.isOpen = true; },
    closeCart: (state) => { state.isOpen = false; },
    resetCart: (state) => { Object.assign(state, initialCartState); },
    toggleItemSelection: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const idx = state.selectedItemIds.indexOf(id);
      if (idx === -1) state.selectedItemIds.push(id);
      else state.selectedItemIds.splice(idx, 1);
    },
    toggleStoreSelection: (state, action: PayloadAction<string[]>) => {
      // action.payload = all item IDs for a store
      const storeIds = action.payload;
      const allSelected = storeIds.every((id) => state.selectedItemIds.includes(id));
      if (allSelected) {
        state.selectedItemIds = state.selectedItemIds.filter((id) => !storeIds.includes(id));
      } else {
        const toAdd = storeIds.filter((id) => !state.selectedItemIds.includes(id));
        state.selectedItemIds.push(...toAdd);
      }
    },
    selectAllItems: (state) => {
      state.selectedItemIds = state.items.map((i) => i._id);
    },
    deselectAllItems: (state) => {
      state.selectedItemIds = [];
    },
    setSelectedItemIds: (state, action: PayloadAction<string[]>) => {
      state.selectedItemIds = action.payload;
    },
  },
  extraReducers: (builder) => {
    const handleCartUpdate = (state: CartState, action: PayloadAction<Cart>) => {
      state.isLoading = false;
      state.items = action.payload.items;
      state.subtotal = action.payload.subtotal;
      state.itemCount = action.payload.itemCount;
      // Only update coupon when the response explicitly includes the coupon key (fetchCart).
      // Mutation responses (add/update/remove) omit the key, so payload.coupon is undefined.
      if (action.payload.coupon !== undefined) {
        state.coupon = action.payload.coupon?.code ? action.payload.coupon : undefined;
      }
      // Keep only selections that still exist in the updated cart
      const itemIds = new Set(action.payload.items.map((i) => i._id));
      state.selectedItemIds = state.selectedItemIds.filter((id) => itemIds.has(id));
    };

    builder
      .addCase(fetchCart.pending, (state) => { state.isLoading = true; })
      .addCase(fetchCart.fulfilled, handleCartUpdate)
      .addCase(fetchCart.rejected, (state) => { state.isLoading = false; });

    builder
      .addCase(addToCart.pending, (state) => { state.isLoading = true; })
      .addCase(addToCart.fulfilled, handleCartUpdate)
      .addCase(addToCart.rejected, (state) => { state.isLoading = false; });

    builder
      .addCase(updateCartItem.fulfilled, handleCartUpdate);

    builder
      .addCase(removeFromCart.fulfilled, handleCartUpdate);

    builder
      .addCase(clearCart.fulfilled, (state) => {
        state.items = [];
        state.subtotal = 0;
        state.itemCount = 0;
        state.coupon = undefined;
      });

    builder
      .addCase(applyCoupon.fulfilled, (state, action: any) => {
        state.coupon = action.payload.coupon;
      });
  },
});

export const {
  toggleCart, openCart, closeCart, resetCart,
  toggleItemSelection, toggleStoreSelection, selectAllItems, deselectAllItems, setSelectedItemIds,
} = cartSlice.actions;
export const cartReducer = cartSlice.reducer;

// ============================================================
// UI SLICE
// ============================================================

interface UiState {
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  searchOpen: boolean;
  mobileMenuOpen: boolean;
}

const uiInitial: UiState = {
  theme: (localStorage.getItem('theme') as UiState['theme']) || 'light',
  sidebarOpen: false,
  searchOpen: false,
  mobileMenuOpen: false,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState: uiInitial,
  reducers: {
    setTheme: (state, action: PayloadAction<UiState['theme']>) => {
      state.theme = action.payload;
      localStorage.setItem('theme', action.payload);
    },
    toggleSidebar: (state) => { state.sidebarOpen = !state.sidebarOpen; },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => { state.sidebarOpen = action.payload; },
    toggleSearch: (state) => { state.searchOpen = !state.searchOpen; },
    setSearchOpen: (state, action: PayloadAction<boolean>) => { state.searchOpen = action.payload; },
    toggleMobileMenu: (state) => { state.mobileMenuOpen = !state.mobileMenuOpen; },
  },
});

export const {
  setTheme, toggleSidebar, setSidebarOpen,
  toggleSearch, setSearchOpen, toggleMobileMenu,
} = uiSlice.actions;

export const uiReducer = uiSlice.reducer;

// ============================================================
// PRODUCT SLICE
// ============================================================

import { Product, ProductFilters, PaginatedResponse } from '@/types';

interface ProductState {
  products: Product[];
  featured: Product[];
  trending: Product[];
  newArrivals: Product[];
  currentProduct: Product | null;
  filters: ProductFilters;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  isLoading: boolean;
  error: string | null;
}

const productInitial: ProductState = {
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
      const params = new URLSearchParams(
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      );
      const { data } = await api.get(`/products?${params}`);
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
  } catch (err: any) {
    return rejectWithValue(err.message);
  }
});

export const fetchProduct = createAsyncThunk(
  'products/fetchOne',
  async (slug: string, { rejectWithValue }) => {
    try {
      const { data } = await api.get(`/products/${slug}`);
      return data.data;
    } catch (err: any) {
      return rejectWithValue(err.message);
    }
  }
);

export const productSlice = createSlice({
  name: 'products',
  initialState: productInitial,
  reducers: {
    setFilters: (state, action: PayloadAction<Partial<ProductFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => {
      state.filters = productInitial.filters;
    },
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

    builder
      .addCase(fetchFeatured.fulfilled, (state, action: any) => {
        state.featured = action.payload.featured;
        state.trending = action.payload.trending;
        state.newArrivals = action.payload.newArrivals;
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
export const productReducer = productSlice.reducer;
