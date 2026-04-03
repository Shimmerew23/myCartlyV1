import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import toast from 'react-hot-toast';

// ============================================================
// Axios Instance
// ============================================================
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // Send cookies
});

// Track if we're refreshing to prevent loops
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
};

// ============================================================
// Request Interceptor — Attach access token from store
// ============================================================
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Get token from localStorage (set by Redux on login)
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ============================================================
// Response Interceptor — Handle 401 + Token Refresh
// ============================================================
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 Unauthorized — attempt token refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }).catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        const newToken = data.data.accessToken;
        localStorage.setItem('accessToken', newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        toast.error('Session expired. Please log in again.');
        window.dispatchEvent(new CustomEvent('auth:logout'));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle specific error codes
    const message = (error.response?.data as { message?: string })?.message || error.message;

    if (error.response?.status === 429) {
      toast.error('Too many requests. Please slow down.');
    } else if (error.response?.status === 503) {
      toast.error('Service temporarily unavailable. Try again shortly.');
    } else if (!error.response && error.message === 'Network Error') {
      toast.error('Network error. Please check your connection.');
    }

    return Promise.reject({ ...error, message });
  }
);

// ============================================================
// Typed API helpers
// ============================================================
export const apiGet = <T>(url: string, params?: object) =>
  api.get<{ data: T }>(url, { params }).then((r) => r.data.data);

export const apiPost = <T>(url: string, data?: object) =>
  api.post<{ data: T }>(url, data).then((r) => r.data.data);

export const apiPut = <T>(url: string, data?: object) =>
  api.put<{ data: T }>(url, data).then((r) => r.data.data);

export const apiDelete = <T>(url: string) =>
  api.delete<{ data: T }>(url).then((r) => r.data.data);

export const apiUpload = <T>(url: string, formData: FormData, method: 'post' | 'put' = 'post') =>
  api({
    method,
    url,
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data.data as T);

export default api;
