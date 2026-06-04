import { http, HttpResponse } from 'msw';

// Must match test.env.VITE_API_URL in vite.config.ts (axios baseURL).
export const API_BASE = 'http://localhost:5000/api';

// Default handlers shared across suites. Individual tests override with server.use(...).
export const handlers = [
  http.get(`${API_BASE}/carriers`, () => HttpResponse.json({ data: [] })),
];
