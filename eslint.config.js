// Flat config (ESLint 9). Scoped to src/**/*.js — the JS engine
// module and its tests. Deno edge functions in supabase/functions
// are TypeScript and would need @typescript-eslint to parse the
// non-null assertion operator; deferred until the build PR lands.
// index.html / enroll.html are intentionally excluded until the
// chunk-6 module split happens.

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType:  'module',
      globals: {
        console: 'readonly',
      },
    },
    rules: {
      'no-unused-vars':     ['warn', { argsIgnorePattern: '^_' }],
      'no-undef':           'error',
      'no-implicit-globals':'error',
      'eqeqeq':             ['error', 'smart'],
      'no-var':             'error',
      'prefer-const':       'warn',
    },
  },
]
