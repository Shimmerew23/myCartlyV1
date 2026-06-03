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
