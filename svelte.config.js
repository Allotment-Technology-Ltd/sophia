import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const aaifSrc = fileURLToPath(new URL('./packages/aaif/src', import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    alias: {
      '@restormel/aaif': `${aaifSrc}/index.ts`
    }
  }
};

export default config;
