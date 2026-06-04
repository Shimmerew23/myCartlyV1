const { assertProductionSecrets } = require('../utils/validateEnv');

describe('assertProductionSecrets', () => {
  const base = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a',
    JWT_REFRESH_SECRET: 'b',
    SESSION_SECRET: 'c',
  };

  it('does not throw when all required secrets are set in production', () => {
    expect(() => assertProductionSecrets(base)).not.toThrow();
  });

  it('throws when a required secret is missing in production', () => {
    const env = { ...base, SESSION_SECRET: undefined };
    expect(() => assertProductionSecrets(env)).toThrow(/SESSION_SECRET/);
  });

  it('is a no-op outside production', () => {
    const env = { NODE_ENV: 'test' };
    expect(() => assertProductionSecrets(env)).not.toThrow();
  });
});
