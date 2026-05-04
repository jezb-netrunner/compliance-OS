// Flat config (ESLint 9). Two scopes:
//   1. src/**/*.js — engine module + tests (Node / browser)
//   2. supabase/functions/**/*.ts — Deno edge functions
// index.html / enroll.html are intentionally excluded; they get
// linted once the chunk-9 Vite build splits them into modules.

import tseslint from 'typescript-eslint'

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

  // Deno edge functions: parsed by @typescript-eslint, but kept on a
  // looser ruleset because the Deno runtime is not declared via
  // @types/deno here (would require a bigger toolchain bump).
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      ...(cfg.languageOptions ?? {}),
      globals: {
        Deno:     'readonly',
        console:  'readonly',
        fetch:    'readonly',
        Response: 'readonly',
      },
    },
  })),
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'eqeqeq': ['error', 'smart'],
    },
  },
]
