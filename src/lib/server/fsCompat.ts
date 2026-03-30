/**
 * Firestore-shaped Timestamp and FieldValue sentinels for the Neon `sophia_documents` layer (`sophiaDocumentsDb`).
 * Keeps types aligned with the compat API without depending on Google Firestore SDKs at runtime.
 */

export class Timestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number
  ) {}

  static now(): Timestamp {
    const ms = Date.now();
    return Timestamp.fromMillis(ms);
  }

  static fromMillis(milliseconds: number): Timestamp {
    const seconds = Math.floor(milliseconds / 1000);
    const nanoseconds = (milliseconds % 1000) * 1_000_000;
    return new Timestamp(seconds, nanoseconds);
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }

  toDate(): Date {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000));
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }
}

export const FieldValue = {
  increment(operand: number): { methodName: 'FieldValue.increment'; operand: number } {
    return { methodName: 'FieldValue.increment', operand };
  },
  serverTimestamp(): { methodName: 'FieldValue.serverTimestamp' } {
    return { methodName: 'FieldValue.serverTimestamp' };
  },
  delete(): { methodName: 'FieldValue.delete' } {
    return { methodName: 'FieldValue.delete' };
  }
} as const;
