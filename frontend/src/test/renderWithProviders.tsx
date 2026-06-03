import { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import authReducer from '@/store/slices/authSlice';
import { cartReducer } from '@/store/slices/cartSlice';
import productReducer from '@/store/slices/productSlice';
import uiReducer from '@/store/slices/uiSlice';

// Mirror store/index.ts so component behavior matches production.
export function makeStore(preloadedState?: Record<string, unknown>) {
  return configureStore({
    reducer: {
      auth: authReducer,
      cart: cartReducer,
      products: productReducer,
      ui: uiReducer,
    },
    preloadedState: preloadedState as never,
    // Mirror production middleware (store/index.ts) so tests still catch non-serializable dispatches.
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: { ignoredActions: ['auth/setCredentials'] },
      }),
  });
}

interface Options {
  preloadedState?: Record<string, unknown>;
  route?: string;
}

export function renderWithProviders(ui: ReactElement, opts: Options = {}) {
  const { preloadedState, route = '/' } = opts;
  const store = makeStore(preloadedState);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </Provider>
  );
  return { store, queryClient, ...result };
}
