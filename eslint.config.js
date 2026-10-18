import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/dev-dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      // domain — чистое ядро: без React, сети и DOM (раздел 2)
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-*', 'fastify', '@fastify/*', 'dexie', 'zustand'] },
      ],
      'no-restricted-globals': ['error', 'fetch', 'window', 'document', 'localStorage', 'indexedDB'],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/api/**/*.ts', '*.{js,ts}', 'deploy/**/*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
