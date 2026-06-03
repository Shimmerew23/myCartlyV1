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
