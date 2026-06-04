// Fail-fast check that critical signing secrets exist in production.
// In non-production (dev/test) it is a no-op so local + CI runs stay frictionless.
const REQUIRED_PRODUCTION_SECRETS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET'];

function assertProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing required production secret(s): ${missing.join(', ')}`
    );
  }
}

module.exports = { assertProductionSecrets, REQUIRED_PRODUCTION_SECRETS };
