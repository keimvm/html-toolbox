import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.{ts,tsx,js}', 'scripts/**/*.test.mjs'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dist',
            environment: 'node',
            include: ['tests/dist/**/*.test.ts'],
          },
        },
      ],
    },
  }),
);
