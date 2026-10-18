import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist/**',
    'build/**',
    'out/**',
    'output/**',
    'coverage/**',
    'tools/**',
    'local-samples/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,js}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      '*.{ts,mjs}',
      'vite/**/*.ts',
      'scripts/**/*.mjs',
      'tests/**/*.ts',
      'src/**/*.test.{ts,tsx,js}',
      'src/**/*.test-support.{ts,js}',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]);
