describe('initSentry', () => {
  const original = process.env.SENTRY_DSN;
  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it('is a safe no-op when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const { initSentry } = require('../config/sentry');
    expect(() => initSentry()).not.toThrow();
  });

  it('does not throw when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { initSentry } = require('../config/sentry');
    expect(() => initSentry()).not.toThrow();
  });
});
