import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const contractsSrc = fileURLToPath(new URL('./packages/contracts/src', import.meta.url));
const aaifSrc = fileURLToPath(new URL('./packages/aaif/src', import.meta.url));
const graphCoreSrc = fileURLToPath(new URL('./packages/graph-core/src', import.meta.url));
const observabilitySrc = fileURLToPath(new URL('./packages/observability/src', import.meta.url));

export default defineConfig({
  root: repoRoot,
  plugins: [sveltekit()],
  // Bundle Restormel Keys for SSR so `@restormel/keys` and `@restormel/keys/dashboard`
  // resolve via Vite (avoids flaky `nodeImport` / package-exports edge cases with externalized deps).
  ssr: {
    noExternal: ['@restormel/keys']
  },
  server: {
    fs: {
      allow: [repoRoot]
    },
    watch: {
      // Ingestion runs write artifacts during execution; ignore them so dev
      // server doesn't hot-reload/restart mid-run.
      ignored: [
        '**/data/sources/**',
        '**/data/ingested/**',
        '**/data/monitoring/**'
      ]
    }
  },
  resolve: {
    alias: [
      { find: '@restormel/aaif', replacement: `${aaifSrc}/index.ts` },
      { find: '@restormel/contracts', replacement: `${contractsSrc}/index.ts` },
      { find: /^@restormel\/contracts\/(.+)$/, replacement: `${contractsSrc}/$1.ts` },
      { find: '@restormel/graph-core', replacement: `${graphCoreSrc}/index.ts` },
      { find: /^@restormel\/graph-core\/(.+)$/, replacement: `${graphCoreSrc}/$1.ts` },
      { find: '@restormel/observability', replacement: `${observabilitySrc}/index.ts` },
      { find: /^@restormel\/observability\/(.+)$/, replacement: `${observabilitySrc}/$1.ts` }
    ]
  }
});
