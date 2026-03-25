declare global {
  namespace App {
    interface Locals {
      user?: {
        uid: string;
        email: string | null;
        displayName: string | null;
        photoURL: string | null;
        role: 'user' | 'administrator' | 'owner';
        roles: Array<'user' | 'administrator' | 'owner'>;
      } | null;
      rateLimitRemaining?: number;
    }
    interface PageData {}
    interface Platform {}
  }
}

export {};
