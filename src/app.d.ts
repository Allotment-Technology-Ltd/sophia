import type { Session } from '@auth/sveltekit';

declare global {
  namespace App {
    interface Locals {}
    interface PageData {}
    interface Platform {}
  }
}

export {};
