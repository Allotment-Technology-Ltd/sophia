declare global {
  namespace App {
    interface Locals {
      user?: {
        uid: string;
        email: string | null;
        displayName: string | null;
        photoURL: string | null;
        role: 'user' | 'administrator';
        roles: Array<'user' | 'administrator'>;
      } | null;
      rateLimitRemaining?: number;
    }
    interface PageData {}
    interface Platform {}
  }
}

export {};
