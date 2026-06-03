module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'vite.config.ts'],
  rules: {
    // TS handles unused-var detection; disable the base rule so it doesn't double-report.
    'no-unused-vars': 'off',
    // `any` is used deliberately in axios error handlers / form payloads. Turned off (not
    // `warn`, which would also fail `--max-warnings 0`) at first-adoption. FOLLOW-UP (3B):
    // tighten to targeted `// eslint-disable-next-line` at the known intentional sites so
    // new `any` usage is caught.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Intentional empty catch blocks (best-effort parses) are allowed.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Deferred: existing fetch-on-mount effects intentionally omit the fetcher from
    // their dep arrays; auto-"fixing" risks refetch loops. rules-of-hooks stays an error.
    // Revisit when these components gain test coverage in 3B.
    'react-hooks/exhaustive-deps': 'off',
  },
};
