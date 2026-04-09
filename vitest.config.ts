import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '$lib', replacement: path.resolve('./src/lib') },
      { find: /^@restormel\/contracts\/(.+)$/, replacement: path.resolve('./packages/contracts/src/$1.ts') },
      { find: '@restormel/contracts', replacement: path.resolve('./packages/contracts/src/index.ts') },
      { find: /^@restormel\/observability\/(.+)$/, replacement: path.resolve('./packages/observability/src/$1.ts') },
      { find: '@restormel/observability', replacement: path.resolve('./packages/observability/src/index.ts') }
    ]
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'packages/contracts/src/**/*.test.ts',
      'packages/graph-reasoning-extensions/src/**/*.test.ts',
      'packages/observability/src/**/*.test.ts'
    ],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.svelte']
    }
  }
});
