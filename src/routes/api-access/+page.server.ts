import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';

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

    try {
      await sophiaDocumentsDb.collection('waitlist').add({
        name,
        email: email.toLowerCase(),
        use_case: useCase,
        created_at: new Date(),
        source: 'api_access_page'
      });
    } catch (err) {
      console.error(
        '[api-access waitlist]',
        err instanceof Error ? err.message : String(err)
      );
      return fail(500, {
        error:
          'We could not save your request right now. Please try again in a moment or email admin@usesophia.app.',
        values: { name, email, useCase }
      });
    }

    return {
      success: true
    };
  }
};
