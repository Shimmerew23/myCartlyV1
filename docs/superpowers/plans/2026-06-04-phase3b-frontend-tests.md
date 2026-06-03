# Phase 3B — Frontend Unit/Component Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Vitest + React Testing Library + MSW test suite covering the frontend's four highest-risk modules (axios helpers + refresh queue, auth slice, cart math, checkout payment selection, admin refund dialog) and wire it into the existing frontend CI job.

**Architecture:** Vitest reuses the existing Vite toolchain via a `test` block in `vite.config.ts` (jsdom env). HTTP is intercepted with MSW (node) so the real axios interceptors run. A `renderWithProviders` helper mounts components inside the real Redux store + React Query + router. Tests are co-located as `*.test.ts(x)`; shared test scaffolding lives in `src/test/`.

**Tech Stack:** Vitest 1.x, @testing-library/react 14, @testing-library/user-event 14, @testing-library/jest-dom 6, jsdom 24, msw 2. Existing: React 18, Redux Toolkit 2, React Query 5, react-router 6, axios 1.

**Spec:** `docs/superpowers/specs/2026-06-04-phase3b-frontend-tests-design.md`

**Conventions for the implementer:**
- All commands run from `frontend/` unless stated. In this repo's shell, prefix git/npm with `cd /e/GitHub/myCartlyV1/frontend &&` if the working directory may have drifted.
- These tasks add **tests against already-working app code**. The TDD loop here is: write the test → run it → expect **PASS**. If a test FAILS, do not weaken it — investigate whether it's a test defect or a genuine app bug, and report a real bug as a `DONE_WITH_CONCERNS`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do **not** `git add` the untracked `.claudeignore` or any `.env*` (gitignored). Stage explicit paths only.
- After any task that touches frontend source, `npm run lint` must stay green (`--max-warnings 0`).

---

## File Structure

**Created:**
- `frontend/vitest.setup.ts` — global test setup (jest-dom matchers, MSW lifecycle, cleanup).
- `frontend/src/test/server.ts` — MSW `setupServer` instance.
- `frontend/src/test/handlers.ts` — default MSW request handlers + shared `API_BASE` constant.
- `frontend/src/test/renderWithProviders.tsx` — RTL render wrapper (store + QueryClient + router).
- `frontend/src/api/axios.test.ts` — axios helpers + refresh-queue tests.
- `frontend/src/store/slices/authSlice.test.ts` — auth reducers + login thunk.
- `frontend/src/store/slices/cartSlice.test.ts` — cart math reducers.
- `frontend/src/pages/Checkout.test.tsx` — payment-method selection.
- `frontend/src/pages/admin/AdminOrders.test.tsx` — refund dialog.

**Modified:**
- `frontend/package.json` — dev deps + `test`/`test:run` scripts.
- `frontend/vite.config.ts` — import from `vitest/config`, add `test` block.
- `frontend/.eslintrc.cjs` — override so test files/setup don't trip `no-undef`/`no-empty` etc.
- `.github/workflows/ci.yml` — add `npm run test:run` to the frontend job.
- `CLAUDE.md`, `docs/ROADMAP.md` — document 3B.

---

## Task 1: Test harness setup

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/.eslintrc.cjs`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/test/server.ts`
- Create: `frontend/src/test/handlers.ts`
- Create: `frontend/src/test/renderWithProviders.tsx`
- Create (temporary): `frontend/src/test/smoke.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run (from `frontend/`):
```bash
npm install -D vitest@^1.6.0 jsdom@^24.1.0 @testing-library/react@^14.2.1 @testing-library/user-event@^14.5.2 @testing-library/jest-dom@^6.4.2 msw@^2.3.1
```
Expected: installs succeed; `package.json` gains the six devDependencies. (npm may warn about peer ranges; that's fine as long as install completes.)

- [ ] **Step 2: Add test scripts to `package.json`**

In `frontend/package.json`, change the `scripts` block to:
```json
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "test": "vitest",
    "test:run": "vitest run"
  },
```

- [ ] **Step 3: Add the Vitest `test` block to `vite.config.ts`**

Change the import on line 2 from `vite` to `vitest/config`, and add a `test` block. The full file becomes:
```ts
// vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    env: {
      VITE_API_URL: 'http://localhost:5000/api',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
          ui: ['framer-motion', 'lucide-react'],
          charts: ['recharts'],
        },
      },
    },
  },
});
```
Note: `vite.config.ts` is in the ESLint `ignorePatterns`, so this file is not linted. `globals: false` means tests import `describe/it/expect/vi` explicitly (keeps ESLint `no-undef` happy without extra config).

- [ ] **Step 4: Create `frontend/src/test/handlers.ts`**

```ts
import { http, HttpResponse } from 'msw';

// Must match test.env.VITE_API_URL in vite.config.ts (axios baseURL).
export const API_BASE = 'http://localhost:5000/api';

// Default handlers shared across suites. Individual tests override with server.use(...).
export const handlers = [
  http.get(`${API_BASE}/carriers`, () => HttpResponse.json({ data: [] })),
];
```

- [ ] **Step 5: Create `frontend/src/test/server.ts`**

```ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

- [ ] **Step 6: Create `frontend/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './src/test/server';

// jsdom does not implement matchMedia; some components read it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  localStorage.clear();
});
afterAll(() => server.close());
```

- [ ] **Step 7: Create `frontend/src/test/renderWithProviders.tsx`**

```tsx
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
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
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
```

- [ ] **Step 8: Add an ESLint override for test files**

In `frontend/.eslintrc.cjs`, add an `overrides` array (top-level key, after `rules`) so test scaffolding is linted with node env and test-friendly rules. The file's exported object gains:
```js
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*.{ts,tsx}', 'vitest.setup.ts'],
      env: { node: true, browser: true },
      rules: {
        // Test fixtures intentionally use partial/`any` shapes and empty stub fns.
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
  ],
```
(Place it as a sibling of `rules:` inside `module.exports = { ... }`. Note `vitest.setup.ts` lives at the frontend root, which ESLint scans via `eslint .`.)

- [ ] **Step 9: Create a temporary smoke test**

`frontend/src/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs and has jsdom + jest-dom', () => {
    const el = document.createElement('div');
    el.textContent = 'hi';
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('hi');
  });
});
```

- [ ] **Step 10: Run the harness**

Run: `npm run test:run`
Expected: 1 test file, 1 test passing. Confirms Vitest + jsdom + jest-dom + setup all load.

- [ ] **Step 11: Confirm lint stays green**

Run: `npm run lint`
Expected: no errors/warnings (exit 0).

- [ ] **Step 12: Delete the smoke test and re-run lint**

```bash
rm src/test/smoke.test.ts
npm run lint
```
Expected: lint exit 0. (The smoke test proved the harness; real suites follow.)

- [ ] **Step 13: Commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
git add package.json package-lock.json vite.config.ts .eslintrc.cjs vitest.setup.ts src/test/server.ts src/test/handlers.ts src/test/renderWithProviders.tsx
git commit -m "test(frontend): add Vitest + RTL + MSW harness" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `api/axios.ts` — helpers + 401 refresh queue

**Files:**
- Create: `frontend/src/api/axios.test.ts`

The axios module has module-level refresh state (`isRefreshing`, `failedQueue`) and reads `localStorage`. Each test must reset modules so that state is fresh. Use `vi.resetModules()` + dynamic `import('./axios')` per test, and mock `react-hot-toast` (the interceptor calls `toast.error`).

- [ ] **Step 1: Write the test file**

`frontend/src/api/axios.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { API_BASE } from '@/test/handlers';

// The response interceptor calls toast.error; stub it so it's a no-op in tests.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// Fresh module (resets isRefreshing/failedQueue) + fresh localStorage per test.
async function freshApi() {
  vi.resetModules();
  return await import('./axios');
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('apiGet/apiPost envelope unwrap', () => {
  it('returns the inner data payload from { data: { data } }', async () => {
    server.use(
      http.get(`${API_BASE}/widgets`, () =>
        HttpResponse.json({ data: { id: 'w1', name: 'Widget' } })
      )
    );
    const { apiGet } = await freshApi();
    const result = await apiGet<{ id: string; name: string }>('/widgets');
    expect(result).toEqual({ id: 'w1', name: 'Widget' });
  });

  it('attaches the Authorization header from localStorage', async () => {
    localStorage.setItem('accessToken', 'tok-123');
    let seenAuth: string | null = null;
    server.use(
      http.get(`${API_BASE}/me`, ({ request }) => {
        seenAuth = request.headers.get('authorization');
        return HttpResponse.json({ data: { ok: true } });
      })
    );
    const { apiGet } = await freshApi();
    await apiGet('/me');
    expect(seenAuth).toBe('Bearer tok-123');
  });
});

describe('401 -> refresh -> retry', () => {
  it('refreshes once and retries the original request with the new token', async () => {
    localStorage.setItem('accessToken', 'old');
    let refreshCount = 0;
    let attempt = 0;
    server.use(
      http.get(`${API_BASE}/secure`, ({ request }) => {
        attempt += 1;
        if (attempt === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ data: { auth: request.headers.get('authorization') } });
      }),
      http.post(`${API_BASE}/auth/refresh`, () => {
        refreshCount += 1;
        return HttpResponse.json({ data: { accessToken: 'fresh' } });
      })
    );
    const { apiGet } = await freshApi();
    const result = await apiGet<{ auth: string }>('/secure');
    expect(refreshCount).toBe(1);
    expect(result.auth).toBe('Bearer fresh');
    expect(localStorage.getItem('accessToken')).toBe('fresh');
  });

  it('dedupes concurrent 401s into a single refresh call (queue)', async () => {
    localStorage.setItem('accessToken', 'old');
    let refreshCount = 0;
    const attempts: Record<string, number> = { a: 0, b: 0 };
    const make401Once = (key: 'a' | 'b') =>
      http.get(`${API_BASE}/r-${key}`, ({ request }) => {
        attempts[key] += 1;
        if (attempts[key] === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ data: { auth: request.headers.get('authorization') } });
      });
    server.use(
      make401Once('a'),
      make401Once('b'),
      http.post(`${API_BASE}/auth/refresh`, async () => {
        refreshCount += 1;
        // small delay so the second 401 arrives while isRefreshing is true
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ data: { accessToken: 'fresh' } });
      })
    );
    const { apiGet } = await freshApi();
    const [ra, rb] = await Promise.all([
      apiGet<{ auth: string }>('/r-a'),
      apiGet<{ auth: string }>('/r-b'),
    ]);
    expect(refreshCount).toBe(1);
    expect(ra.auth).toBe('Bearer fresh');
    expect(rb.auth).toBe('Bearer fresh');
  });

  it('on refresh failure: clears token, dispatches auth:logout, rejects', async () => {
    localStorage.setItem('accessToken', 'old');
    const onLogout = vi.fn();
    window.addEventListener('auth:logout', onLogout);
    server.use(
      http.get(`${API_BASE}/secure`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${API_BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 }))
    );
    const { apiGet } = await freshApi();
    await expect(apiGet('/secure')).rejects.toBeDefined();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:logout', onLogout);
  });
});

describe('auth endpoints are excluded from refresh-retry', () => {
  it('does not call refresh when /auth/login returns 401', async () => {
    let refreshCount = 0;
    server.use(
      http.post(`${API_BASE}/auth/login`, () =>
        HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
      ),
      http.post(`${API_BASE}/auth/refresh`, () => {
        refreshCount += 1;
        return HttpResponse.json({ data: { accessToken: 'x' } });
      })
    );
    const { apiPost } = await freshApi();
    await expect(apiPost('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toBeDefined();
    expect(refreshCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run src/api/axios.test.ts`
Expected: all tests PASS. If the dedupe test is flaky, increase the refresh delay (the `setTimeout(r, 20)`); do not relax the `refreshCount` assertion. If "logout" test fails because the rejection is unhandled, confirm the assertion uses `await expect(...).rejects`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
git add src/api/axios.test.ts
git commit -m "test(frontend): cover axios envelope unwrap + 401 refresh queue" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `authSlice` — reducers + login thunk

**Files:**
- Create: `frontend/src/store/slices/authSlice.test.ts`

The slice's thunks import the shared axios instance (which calls `toast`). Test pure reducers directly with synthetic actions, and the `login` thunk by dispatching it through a store with MSW backing `/auth/login`. Mock `react-hot-toast`.

- [ ] **Step 1: Write the test file**

`frontend/src/store/slices/authSlice.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { API_BASE } from '@/test/handlers';
import reducer, {
  setCredentials,
  clearAuth,
  updateUser,
  login,
} from './authSlice';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const baseUser = {
  _id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'user',
} as never;

beforeEach(() => localStorage.clear());

describe('authSlice reducers', () => {
  it('setCredentials stores user + token and marks authenticated', () => {
    const state = reducer(undefined, setCredentials({ user: baseUser, accessToken: 'tok' }));
    expect(state.user).toEqual(baseUser);
    expect(state.token).toBe('tok');
    expect(state.isAuthenticated).toBe(true);
  });

  it('clearAuth resets to logged-out and clears stored token', () => {
    localStorage.setItem('accessToken', 'tok');
    const authed = reducer(undefined, setCredentials({ user: baseUser, accessToken: 'tok' }));
    const state = reducer(authed, clearAuth());
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('updateUser merges fields into the existing user', () => {
    const authed = reducer(undefined, setCredentials({ user: baseUser, accessToken: 'tok' }));
    const state = reducer(authed, updateUser({ name: 'Ada L.' } as never));
    expect(state.user?.name).toBe('Ada L.');
    expect(state.user?.email).toBe('ada@example.com');
  });
});

describe('login thunk', () => {
  function freshStore() {
    return configureStore({ reducer: { auth: reducer } });
  }

  it('fulfilled: stores user + token, flips isAuthenticated, clears loading', async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, () =>
        HttpResponse.json({ data: { user: baseUser, accessToken: 'tok-9' } })
      )
    );
    const store = freshStore();
    await store.dispatch(login({ email: 'ada@example.com', password: 'pw' }) as never);
    const state = store.getState().auth;
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?._id).toBe('u1');
    expect(state.token).toBe('tok-9');
    expect(state.isLoading).toBe(false);
    expect(localStorage.getItem('accessToken')).toBe('tok-9');
  });

  it('rejected: sets error and clears loading', async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, () =>
        HttpResponse.json({ message: 'Bad creds' }, { status: 401 })
      )
    );
    const store = freshStore();
    await store.dispatch(login({ email: 'ada@example.com', password: 'wrong' }) as never);
    const state = store.getState().auth;
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/store/slices/authSlice.test.ts`
Expected: all PASS. (Login 401 is excluded from refresh-retry in axios, so the rejection surfaces directly — matching the rejected assertions.)

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
npm run lint
git add src/store/slices/authSlice.test.ts
git commit -m "test(frontend): cover auth slice reducers + login thunk" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `cartSlice` — cart math

**Files:**
- Create: `frontend/src/store/slices/cartSlice.test.ts`

`handleCartUpdate` runs on `fetchCart/addToCart/updateCartItem/removeFromCart` `.fulfilled`. Test it by reducing with manually-constructed fulfilled actions (no network needed) using each thunk's `.fulfilled` action creator, plus `clearCart.fulfilled`.

- [ ] **Step 1: Write the test file**

`frontend/src/store/slices/cartSlice.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  cartReducer,
  fetchCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from './cartSlice';

const item = (id: string, price: number, qty: number) =>
  ({ _id: id, product: { _id: 'p' + id } as never, quantity: qty, price, addedAt: 'now' });

const cartPayload = (items: ReturnType<typeof item>[]) => ({
  items,
  subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
  itemCount: items.reduce((s, i) => s + i.quantity, 0),
});

describe('cartSlice math', () => {
  it('fetchCart.fulfilled populates items, subtotal, itemCount', () => {
    const payload = cartPayload([item('1', 20, 2), item('2', 5, 1)]); // 45, count 3
    const state = cartReducer(undefined, fetchCart.fulfilled(payload as never, '', undefined));
    expect(state.items).toHaveLength(2);
    expect(state.subtotal).toBe(45);
    expect(state.itemCount).toBe(3);
    expect(state.isLoading).toBe(false);
  });

  it('addToCart.fulfilled recomputes totals', () => {
    const payload = cartPayload([item('1', 10, 4)]); // 40, count 4
    const state = cartReducer(undefined, addToCart.fulfilled(payload as never, '', { productId: 'p1', quantity: 4 }));
    expect(state.subtotal).toBe(40);
    expect(state.itemCount).toBe(4);
  });

  it('updateCartItem.fulfilled reflects the new quantity totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 1)]) as never, '', undefined));
    const updated = cartReducer(start, updateCartItem.fulfilled(cartPayload([item('1', 10, 3)]) as never, '', { itemId: '1', quantity: 3 }));
    expect(updated.subtotal).toBe(30);
    expect(updated.itemCount).toBe(3);
  });

  it('removeFromCart.fulfilled drops the item from totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 1), item('2', 10, 1)]) as never, '', undefined));
    const after = cartReducer(start, removeFromCart.fulfilled(cartPayload([item('2', 10, 1)]) as never, '', '1'));
    expect(after.items).toHaveLength(1);
    expect(after.subtotal).toBe(10);
    expect(after.itemCount).toBe(1);
  });

  it('clearCart.fulfilled empties items and zeroes totals', () => {
    const start = cartReducer(undefined, fetchCart.fulfilled(cartPayload([item('1', 10, 2)]) as never, '', undefined));
    const cleared = cartReducer(start, clearCart.fulfilled(null as never, '', undefined));
    expect(cleared.items).toEqual([]);
    expect(cleared.subtotal).toBe(0);
    expect(cleared.itemCount).toBe(0);
  });

  it('prunes selectedItemIds that no longer exist after an update', () => {
    const start = cartReducer(
      { items: [], subtotal: 0, itemCount: 0, isLoading: false, isOpen: false, selectedItemIds: ['1', '2'] } as never,
      fetchCart.fulfilled(cartPayload([item('1', 10, 1)]) as never, '', undefined)
    );
    expect(start.selectedItemIds).toEqual(['1']);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/store/slices/cartSlice.test.ts`
Expected: all PASS. (The `.fulfilled(payload, requestId, arg)` signature is RTK's standard async-thunk action creator.)

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
npm run lint
git add src/store/slices/cartSlice.test.ts
git commit -m "test(frontend): cover cart slice totals + selection pruning" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `Checkout` — payment-method selection

**Files:**
- Create: `frontend/src/pages/Checkout.test.tsx`

Checkout is a 4-step wizard starting at `shipping`. It redirects to `/cart` if `items.length > 0 && selectedItemIds.length === 0`, so preload a selected cart. Payment options for PayPal/GCash render only when `VITE_PAYPAL_ENABLED`/`VITE_GCASH_ENABLED` are `'true'` — stub them. Preload `auth.user` with a default address so the shipping form's `defaultValues` are valid and submit advances without typing. Mock `react-hot-toast`.

- [ ] **Step 1: Write the test file**

`frontend/src/pages/Checkout.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import Checkout from './Checkout';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const cartItem = {
  _id: 'ci1',
  product: { _id: 'p1', seller: { _id: 's1', name: 'Shop One' } },
  quantity: 1,
  price: 50,
  addedAt: 'now',
};

const preloaded = {
  cart: {
    items: [cartItem],
    subtotal: 50,
    itemCount: 1,
    isLoading: false,
    isOpen: false,
    selectedItemIds: ['ci1'],
  },
  auth: {
    user: {
      _id: 'u1',
      name: 'Test Buyer',
      email: 'buyer@example.com',
      role: 'user',
      addresses: [
        { _id: 'a1', label: 'Home', street: '1 Main St', city: 'Townsville', state: 'CA', country: 'US', zipCode: '90001', isDefault: true },
      ],
    },
    token: null,
    isLoading: false,
    isAuthenticated: true,
    error: null,
  },
};

async function gotoPaymentStep() {
  const user = userEvent.setup();
  renderWithProviders(<Checkout />, { preloadedState: preloaded as never, route: '/checkout' });
  // Shipping form is prefilled from the default address -> submit advances to carrier.
  await user.click(await screen.findByRole('button', { name: /continue to carrier/i }));
  // Carrier step -> continue to payment.
  await user.click(await screen.findByRole('button', { name: /continue to payment/i }));
  return user;
}

beforeEach(() => {
  vi.stubEnv('VITE_PAYPAL_ENABLED', 'true');
  vi.stubEnv('VITE_GCASH_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Checkout payment-method selection', () => {
  it('renders PayPal, GCash, and COD options with COD selected by default', async () => {
    await gotoPaymentStep();
    expect(await screen.findByRole('radio', { name: /cash on delivery/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /paypal/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /gcash/i })).toBeInTheDocument();
  });

  it('selecting PayPal checks it and the review step reflects the choice', async () => {
    const user = await gotoPaymentStep();
    await user.click(screen.getByRole('radio', { name: /paypal/i }));
    expect(screen.getByRole('radio', { name: /paypal/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /cash on delivery/i })).not.toBeChecked();
    // Advance to review and confirm the payment summary shows PayPal.
    await user.click(screen.getByRole('button', { name: /review order/i }));
    await waitFor(() => expect(screen.getByText(/PayPal/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/pages/Checkout.test.tsx`
Expected: both tests PASS. The default `GET /carriers` handler (returns `{ data: [] }`) covers the mount effect. If the radio accessible-name query fails (label concatenates emoji + text), fall back to selecting by value, e.g. `container.querySelector('input[name="payment"][value="paypal"]')` via the render result — keep the behavioral assertions (`toBeChecked`).

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
npm run lint
git add src/pages/Checkout.test.tsx
git commit -m "test(frontend): cover checkout payment-method selection" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Admin Orders — refund dialog

**Files:**
- Create: `frontend/src/pages/admin/AdminOrders.test.tsx`

`AdminOrders` loads the list via `api.get('/admin/orders')` → response body `{ data: [...orders], pagination }`. The Refund icon (title `"Refund"`) shows only when `paymentStatus ∈ {paid, partially_refunded}`. `confirmRefund` POSTs to `/orders/:id/refund`: blank amount → no `amount` field (full refund); amount that isn't `> 0` → validation error + no request; valid amount + reason → `{ amount, reason }`. Mock `react-hot-toast`.

- [ ] **Step 1: Write the test file**

`frontend/src/pages/admin/AdminOrders.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { server } from '@/test/server';
import { API_BASE } from '@/test/handlers';
import AdminOrders from './Orders';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const order = {
  _id: 'o1',
  orderNumber: 'CUR-1-000001',
  user: { name: 'Buyer', email: 'buyer@example.com' },
  items: [{ _id: 'oi1' }],
  totalPrice: 100,
  paymentMethod: 'cod',
  paymentStatus: 'paid',
  status: 'delivered',
  createdAt: new Date('2026-06-01').toISOString(),
  paymentResult: { refundedAmount: 0 },
};

function mockList() {
  server.use(
    http.get(`${API_BASE}/admin/orders`, () =>
      HttpResponse.json({ data: [order], pagination: { page: 1, pages: 1, total: 1 } })
    )
  );
}

async function openRefundDialog() {
  const user = userEvent.setup();
  mockList();
  renderWithProviders(<AdminOrders />, { route: '/admin/orders' });
  const refundBtn = await screen.findByTitle('Refund');
  await user.click(refundBtn);
  expect(await screen.findByRole('heading', { name: /refund order/i })).toBeInTheDocument();
  return user;
}

beforeEach(() => localStorage.clear());

describe('AdminOrders refund dialog', () => {
  it('shows the refundable balance (total - already refunded)', async () => {
    await openRefundDialog();
    expect(screen.getByText(/Refundable balance:/i)).toHaveTextContent('100.00');
  });

  it('blank amount issues a full refund (POST without amount)', async () => {
    let body: unknown = 'NOT_CALLED';
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { refund: { paymentStatus: 'refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    await waitFor(() => expect(body).not.toBe('NOT_CALLED'));
    expect(body).toEqual({}); // no amount, no reason
  });

  it('rejects a non-positive amount without calling the API', async () => {
    let called = false;
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, () => {
        called = true;
        return HttpResponse.json({ data: { refund: { paymentStatus: 'refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.type(screen.getByRole('spinbutton'), '0');
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    // Dialog stays open (early return) and no request fired.
    expect(screen.getByRole('heading', { name: /refund order/i })).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('valid amount + reason posts { amount, reason }', async () => {
    let body: any = null;
    server.use(
      http.post(`${API_BASE}/orders/o1/refund`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { refund: { paymentStatus: 'partially_refunded' } } });
      })
    );
    const user = await openRefundDialog();
    await user.type(screen.getByRole('spinbutton'), '40');
    await user.type(screen.getByPlaceholderText(/optional note/i), 'damaged');
    await user.click(screen.getByRole('button', { name: /issue refund/i }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ amount: 40, reason: 'damaged' });
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/pages/admin/AdminOrders.test.tsx`
Expected: all PASS. If `useOrderStatusUpdate`/`fetchActiveCarriers` (imported by the component) make an unexpected request on mount, MSW's `onUnhandledRequest: 'error'` will surface it — add a permissive handler for that endpoint to `openRefundDialog`/the test rather than disabling the guard. (On mount only `GET /admin/orders` is expected.)

- [ ] **Step 3: Lint + commit**

```bash
cd /e/GitHub/myCartlyV1/frontend
npm run lint
git add src/pages/admin/AdminOrders.test.tsx
git commit -m "test(frontend): cover admin refund dialog validation + payload" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire tests into CI + docs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run the full suite once to confirm green end-to-end**

Run (from `frontend/`): `npm run test:run`
Expected: 5 test files, all tests passing.

- [ ] **Step 2: Add the test step to the frontend CI job**

In `.github/workflows/ci.yml`, the `frontend` job's steps end with `npm run lint` then `npm run build`. Insert a test step between them so the steps read:
```yaml
      - run: npm ci
      - run: npm run lint
      - run: npm run test:run
      - run: npm run build
```
(Do not rename the job or its display name `Frontend (Lint + Build)` — that string is the required-status-check context configured on `main`'s branch protection; renaming it would silently drop the gate.)

- [ ] **Step 3: Update `CLAUDE.md`**

In the "What this is" paragraph, change "the frontend has no test suite yet." to:
```
the frontend has a **Vitest + React Testing Library** suite (`frontend/src/**/*.test.ts(x)`, MSW for HTTP) added in Phase 3B.
```
In the **Frontend** commands list, add after the `lint` bullet:
```
- `npm test` — Vitest in watch mode · `npm run test:run` — single run (used by CI)
```
In the **CI** paragraph, update the frontend job description from "runs `npm run lint` + `npm run build`" to "runs `npm run lint` + `npm run test:run` (Vitest) + `npm run build`".

- [ ] **Step 4: Update `docs/ROADMAP.md`**

In the Phase 3 "Sub-plan progress" list, mark 3B done with a short detail line (mirror the 3A entry's style), e.g.:
```
- [x] **3B — Frontend unit/component tests** (Vitest + RTL + MSW): axios refresh-queue, auth slice, cart math, checkout payment selection, admin refund dialog; wired into the frontend CI job. Spec: docs/superpowers/specs/2026-06-04-phase3b-frontend-tests-design.md
```
(If the testing workstream has its own row/checkbox in the roadmap tables, tick it too.)

- [ ] **Step 5: Commit**

```bash
cd /e/GitHub/myCartlyV1
git add .github/workflows/ci.yml CLAUDE.md docs/ROADMAP.md
git commit -m "ci+docs: run Vitest in frontend CI job; mark Phase 3B complete" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and confirm CI is green**

```bash
cd /e/GitHub/myCartlyV1
git push origin develop
```
Then confirm the triggered run passes both jobs (the controller will verify via `gh run watch <id> --exit-status`). Expected: backend + frontend jobs green, with the frontend job now running Vitest.

---

## Self-Review

**1. Spec coverage:**
- axios envelope unwrap + 401 refresh queue (dedupe, logout, auth-exclusion) → Task 2 ✓
- auth slice + login flow → Task 3 ✓
- cart math → Task 4 ✓
- checkout payment-method selection → Task 5 ✓
- admin refund dialog (amount validation, blank = full, reason) → Task 6 ✓
- Vitest+RTL+jsdom+jest-dom+user-event+MSW deps, setup, scripts, reuse Vite config → Task 1 ✓
- wire `test:run` into frontend CI job → Task 7 ✓
- co-located `*.test.ts(x)` → all test tasks ✓
- (optional `fuzzy` test) → intentionally omitted per spec "MAY"; not required for done.

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected outputs. The two fallback notes (radio-by-value in Task 5; permissive handler in Task 6) are contingency guidance, not placeholders — the primary path is fully specified.

**3. Type/name consistency:** `API_BASE` defined in `handlers.ts` (Task 1) and imported in Tasks 2/3/6. `server` from `src/test/server.ts` used consistently. `renderWithProviders` signature (`{ preloadedState, route }`) matches all call sites. `cartReducer` (named) / `authReducer` (default) / `productReducer` (default) / `uiReducer` (default) imports mirror `store/index.ts`. Thunk `.fulfilled(payload, requestId, arg)` signature used uniformly in Task 4. Component default exports confirmed: `Checkout` (default `CheckoutPage`), `AdminOrders` (default). Env var names `VITE_PAYPAL_ENABLED`/`VITE_GCASH_ENABLED` match `Checkout.tsx`.
