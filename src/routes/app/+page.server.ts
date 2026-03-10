import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return {
    title: 'SOPHIA — Philosophical Reasoning Engine'
  };
};
