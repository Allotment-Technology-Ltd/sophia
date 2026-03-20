import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const contractsSrc = fileURLToPath(new URL('./packages/contracts/src', import.meta.url));
const aaifSrc = fileURLToPath(new URL('./packages/aaif/src', import.meta.url));
const graphCoreSrc = fileURLToPath(new URL('./packages/graph-core/src', import.meta.url));
const observabilitySrc = fileURLToPath(new URL('./packages/observability/src', import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    alias: {
      '@restormel/aaif': `${aaifSrc}/index.ts`,
      '@restormel/contracts': `${contractsSrc}/index.ts`,
      '@restormel/contracts/*': `${contractsSrc}/*`,
      '@restormel/graph-core': `${graphCoreSrc}/index.ts`,
      '@restormel/graph-core/*': `${graphCoreSrc}/*`,
      '@restormel/observability': `${observabilitySrc}/index.ts`,
      '@restormel/observability/*': `${observabilitySrc}/*`
    }
  }
};

export default config;
