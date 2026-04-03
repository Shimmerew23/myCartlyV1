import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import api from '@/api/axios';
import { User, LoginForm, RegisterForm } from '@/types';
import toast from 'react-hot-toast';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

const storedToken = localStorage.getItem('accessToken');

const initialState: AuthState = {
  user: null,
  token: storedToken,
  isLoading: !!storedToken, // stay loading until fetchMe resolves, prevents redirect on refresh
  isAuthenticated: false,
  error: null,
};

// ============================================================
// Async Thunks
// ============================================================

export const login = createAsyncThunk(
  'auth/login',
  async (credentials: LoginForm, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/auth/login', credentials);
      localStorage.setItem('accessToken', data.data.accessToken);
      toast.success(`Welcome back, ${data.data.user.name}!`);
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
      return rejectWithValue(err.message);
    }
  }
);

export const register = createAsyncThunk(
  'auth/register',
  async (userData: RegisterForm, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/auth/register', userData);
      localStorage.setItem('accessToken', data.data.accessToken);
      toast.success('Account created! Please verify your email.');
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
      return rejectWithValue(err.message);
    }
  }
);

export const logout = createAsyncThunk('auth/logout', async (_, { rejectWithValue }) => {
  try {
    await api.post('/auth/logout');
    localStorage.removeItem('accessToken');
    toast.success('Logged out successfully');
  } catch (err: any) {
    localStorage.removeItem('accessToken');
    return rejectWithValue(err.message);
  }
});

export const fetchMe = createAsyncThunk('auth/fetchMe', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/auth/me');
    return data.data;
  } catch (err: any) {
    localStorage.removeItem('accessToken');
    return rejectWithValue(err.message);
  }
});

export const updateProfile = createAsyncThunk(
  'auth/updateProfile',
  async (formData: FormData, { rejectWithValue }) => {
    try {
      const { data } = await api.put('/users/profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Profile updated successfully');
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
      return rejectWithValue(err.message);
    }
  }
);

export const upgradeToSeller = createAsyncThunk(
  'auth/upgradeToSeller',
  async (formData: FormData, { rejectWithValue }) => {
    try {
      const { data } = await api.post('/users/upgrade-seller', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Seller application submitted!');
      return data.data;
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit seller application');
      return rejectWithValue(err.message);
    }
  }
);

// ============================================================
// Slice
// ============================================================

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<{ user: User; accessToken: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.accessToken;
      state.isAuthenticated = true;
    },
    clearAuth: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      localStorage.removeItem('accessToken');
    },
    updateUser: (state, action: PayloadAction<Partial<User>>) => {
      if (state.user) {
        state.user = { ...state.user, ...action.payload };
      }
    },
  },
  extraReducers: (builder) => {
    // Login
    builder
      .addCase(login.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.accessToken;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Register
    builder
      .addCase(register.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(register.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.accessToken;
        state.isAuthenticated = true;
      })
      .addCase(register.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Logout
    builder
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
      })
      .addCase(logout.rejected, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
      });

    // Fetch Me
    builder
      .addCase(fetchMe.pending, (state) => { state.isLoading = true; })
      .addCase(fetchMe.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(fetchMe.rejected, (state) => {
        state.isLoading = false;
        state.user = null;
        state.isAuthenticated = false;
        state.token = null;
      });

    // Update Profile
    builder
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      });

    // Upgrade to Seller
    builder
      .addCase(upgradeToSeller.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const { setCredentials, clearAuth, updateUser } = authSlice.actions;
export default authSlice.reducer;
