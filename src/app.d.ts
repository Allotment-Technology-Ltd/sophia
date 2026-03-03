declare global {
  namespace App {
    interface Locals {
      user?: {
        uid: string;
        email: string | null;
        displayName: string | null;
        photoURL: string | null;
      } | null;
    }
    interface PageData {}
    interface Platform {}
  }
}

export {};
