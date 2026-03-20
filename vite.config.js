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
  server: {
    fs: {
      allow: [repoRoot]
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
