import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminDb } from '$lib/server/firebase-admin';

export const load: PageServerLoad = async () => {
  return {};
};

export const actions: Actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const useCase = String(formData.get('use_case') ?? '').trim();

    if (!name || !email || !useCase) {
      return fail(400, {
        error: 'Name, email, and use case are required.',
        values: { name, email, useCase }
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return fail(400, {
        error: 'Please enter a valid email address.',
        values: { name, email, useCase }
      });
    }

    await adminDb.collection('waitlist').add({
      name,
      email: email.toLowerCase(),
      use_case: useCase,
      created_at: new Date(),
      source: 'api_access_page'
    });

    return {
      success: true
    };
  }
};
