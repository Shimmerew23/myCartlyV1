import { describe, it, expect } from 'vitest';
import { initSentry } from './sentry';

describe('initSentry', () => {
  it('is a safe no-op when VITE_SENTRY_DSN is unset', () => {
    // vitest config does not set VITE_SENTRY_DSN, so this must not throw.
    expect(() => initSentry()).not.toThrow();
  });
});
