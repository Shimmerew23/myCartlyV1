import * as Sentry from '@sentry/react';

// Initialize Sentry only when a DSN is configured. No DSN -> no-op,
// so dev/CI builds (and tests) run with error tracking disabled.
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [], // errors only: no Session Replay, no browser tracing
  });
}
