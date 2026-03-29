/**
 * Firestore-shaped API on `sophia_documents` when `useNeonDatastore()` is true
 * (DATABASE_URL set and SOPHIA_DATA_BACKEND not `firestore`).
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '$lib/server/db/neon';
import { sophiaDocuments } from '$lib/server/db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleTx = any;

function isIncrementSentinel(v: unknown): v is { methodName: string; operand: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'methodName' in v &&
    (v as { methodName?: string }).methodName === 'FieldValue.increment' &&
    typeof (v as { operand?: unknown }).operand === 'number'
  );
}

function isServerTimestampSentinel(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    'methodName' in v &&
    (v as { methodName?: string }).methodName === 'FieldValue.serverTimestamp'
  );
}

function encodeFirestoreValue(v: unknown): unknown {
  if (v instanceof Timestamp) {
    return { __fsTs: true, seconds: v.seconds, nanoseconds: v.nanoseconds };
  }
  if (v instanceof Date) {
    const ms = v.getTime();
    return { __fsTs: true, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 };
  }
  if (Array.isArray(v)) return v.map(encodeFirestoreValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = encodeFirestoreValue(val);
    }
    return out;
  }
  return v;
}

function decodeFirestoreValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && (v as { __fsTs?: boolean }).__fsTs === true) {
    const s = (v as { seconds?: number; nanoseconds?: number }).seconds ?? 0;
    const n = (v as { nanoseconds?: number }).nanoseconds ?? 0;
    return Timestamp.fromMillis(s * 1000 + Math.floor(n / 1_000_000));
  }
  if (Array.isArray(v)) return v.map(decodeFirestoreValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = decodeFirestoreValue(val);
    }
    return out;
  }
  return v;
}

function applyFieldPatches(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(patch)) {
    if (isIncrementSentinel(val)) {
      const cur = Number(base[k]) || 0;
      base[k] = cur + val.operand;
    } else if (isServerTimestampSentinel(val)) {
      base[k] = Timestamp.now();
    } else if (
      val &&
      typeof val === 'object' &&
      'methodName' in val &&
      (val as { methodName?: string }).methodName === 'FieldValue.delete'
    ) {
      delete base[k];
    } else {
      base[k] = decodeFirestoreValue(encodeFirestoreValue(val)) as unknown;
    }
  }
}

function topCollectionFromPath(path: string): string {
  return path.split('/')[0] ?? path;
}

function slashCount(p: string): number {
  return (p.match(/\//g) ?? []).length;
}

export class NeonDocRef {
  constructor(
    readonly path: string,
    readonly top: string,
    readonly id: string
  ) {}

  collection(name: string): NeonCollectionRef {
    const subPath = `${this.path}/${name}`;
    return new NeonCollectionRef(subPath, topCollectionFromPath(this.path));
  }

  async get(): Promise<NeonDocSnap> {
    const db = getDrizzleDb();
    const row = await db.query.sophiaDocuments.findFirst({
      where: eq(sophiaDocuments.path, this.path)
    });
    if (!row) return new NeonDocSnap(false, undefined, this.id, this);
    return new NeonDocSnap(true, row.data as Record<string, unknown>, this.id, this);
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    const db = getDrizzleDb();
    const enc = encodeFirestoreValue(data) as Record<string, unknown>;
    const createdAtRaw = enc.createdAt ?? enc.created_at;
    let sort: Date | null = null;
    if (createdAtRaw && typeof createdAtRaw === 'object' && (createdAtRaw as { __fsTs?: boolean }).__fsTs) {
      const ts = decodeFirestoreValue(createdAtRaw) as Timestamp;
      sort = ts.toDate();
    }
    if (options?.merge) {
      const existing = await db.query.sophiaDocuments.findFirst({
        where: eq(sophiaDocuments.path, this.path)
      });
      const base = { ...(existing?.data as Record<string, unknown> | undefined) };
      Object.assign(base, enc);
      await db
        .insert(sophiaDocuments)
        .values({
          path: this.path,
          topCollection: this.top,
          data: base,
          sortCreatedAt: sort ?? existing?.sortCreatedAt ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: sophiaDocuments.path,
          set: { data: base, sortCreatedAt: sort ?? existing?.sortCreatedAt ?? null, updatedAt: new Date() }
        });
    } else {
      await db
        .insert(sophiaDocuments)
        .values({
          path: this.path,
          topCollection: this.top,
          data: enc,
          sortCreatedAt: sort,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: sophiaDocuments.path,
          set: { data: enc, sortCreatedAt: sort, updatedAt: new Date() }
        });
    }
  }

  async update(patch: Record<string, unknown>): Promise<void> {
    const db = getDrizzleDb();
    const row = await db.query.sophiaDocuments.findFirst({
      where: eq(sophiaDocuments.path, this.path)
    });
    const base = { ...(row?.data as Record<string, unknown> | undefined) };
    const decoded = decodeFirestoreValue(base) as Record<string, unknown>;
    applyFieldPatches(decoded, patch);
    const enc = encodeFirestoreValue(decoded) as Record<string, unknown>;
    await db
      .insert(sophiaDocuments)
      .values({
        path: this.path,
        topCollection: this.top,
        data: enc,
        sortCreatedAt: row?.sortCreatedAt ?? null,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: sophiaDocuments.path,
        set: { data: enc, updatedAt: new Date() }
      });
  }

  async delete(): Promise<void> {
    const db = getDrizzleDb();
    await db.delete(sophiaDocuments).where(eq(sophiaDocuments.path, this.path));
  }
}

export class NeonDocSnap {
  constructor(
    public readonly exists: boolean,
    private readonly raw: Record<string, unknown> | undefined,
    public readonly id: string,
    public readonly ref: NeonDocRef
  ) {}

  data(): Record<string, unknown> | undefined {
    if (!this.raw) return undefined;
    return decodeFirestoreValue(this.raw) as Record<string, unknown>;
  }
}

export class NeonQuerySnap {
  constructor(public readonly docs: NeonDocSnap[]) {}
  get empty() {
    return this.docs.length === 0;
  }
}

type QClause = { field: string; value: unknown };

class NeonQuery {
  private clauses: QClause[] = [];
  private orders: { field: string; dir: 'asc' | 'desc' }[] = [];
  private lim = 0;

  constructor(
    private readonly prefix: string,
    private readonly top: string
  ) {}

  where(field: string, op: string, value: unknown): this {
    if (op === '==') this.clauses.push({ field, value });
    return this;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): this {
    this.orders.push({ field, dir });
    return this;
  }

  limit(n: number): this {
    this.lim = n;
    return this;
  }

  async get(): Promise<NeonQuerySnap> {
    const db = getDrizzleDb();
    const parentSlashes = slashCount(this.prefix);
    const childSlashes = parentSlashes + 1;
    const like = `${this.prefix}/%`;

    const rows = await db
      .select()
      .from(sophiaDocuments)
      .where(
        and(
          eq(sophiaDocuments.topCollection, this.top),
          sql`(length(${sophiaDocuments.path}) - length(replace(${sophiaDocuments.path}, '/', ''))) = ${childSlashes}`,
          sql`${sophiaDocuments.path} LIKE ${like}`
        )
      );

    let filtered = rows;
    for (const c of this.clauses) {
      filtered = filtered.filter((r) => {
        const data = r.data as Record<string, unknown>;
        const dv = data[c.field];
        const val = c.value;
        if (val instanceof Timestamp) {
          const decoded = decodeFirestoreValue(dv);
          if (decoded instanceof Timestamp) {
            return decoded.seconds === val.seconds && decoded.nanoseconds === val.nanoseconds;
          }
        }
        return dv === val;
      });
    }

    const ord = this.orders[0];
    if (
      ord &&
      (ord.field === 'createdAt' ||
        ord.field === 'created_at' ||
        ord.field === 'completedAt' ||
        ord.field === 'completed_at' ||
        ord.field === 'sort_created_at')
    ) {
      filtered = [...filtered].sort((a, b) => {
        const ta = a.sortCreatedAt?.getTime() ?? 0;
        const tb = b.sortCreatedAt?.getTime() ?? 0;
        return ord.dir === 'desc' ? tb - ta : ta - tb;
      });
    }

    const cap = this.lim > 0 ? this.lim : 500;
    const docs = filtered.slice(0, cap).map((r) => {
      const id = r.path.slice(this.prefix.length + 1);
      const ref = new NeonDocRef(r.path, this.top, id);
      return new NeonDocSnap(true, r.data as Record<string, unknown>, id, ref);
    });
    return new NeonQuerySnap(docs);
  }
}

export class NeonCollectionRef {
  constructor(
    readonly path: string,
    readonly top: string
  ) {}

  doc(id?: string): NeonDocRef {
    const resolved = id && id.length > 0 ? id : crypto.randomUUID();
    const p = `${this.path}/${resolved}`;
    return new NeonDocRef(p, topCollectionFromPath(p), resolved);
  }

  async add(data: Record<string, unknown>): Promise<NeonDocRef> {
    const id = crypto.randomUUID();
    const ref = this.doc(id);
    await ref.set(data);
    return ref;
  }

  where(field: string, op: string, value: unknown): NeonQuery {
    return new NeonQuery(this.path, this.top).where(field, op, value);
  }

  orderBy(field: string, dir?: 'asc' | 'desc'): NeonQuery {
    return new NeonQuery(this.path, this.top).orderBy(field, dir);
  }

  limit(n: number): NeonQuery {
    return new NeonQuery(this.path, this.top).limit(n);
  }

  async get(): Promise<NeonQuerySnap> {
    return new NeonQuery(this.path, this.top).limit(500).get();
  }
}

class NeonTransaction {
  private readonly writes: Array<() => Promise<void>> = [];

  constructor(private readonly trx: DrizzleTx) {}

  async get(ref: NeonDocRef): Promise<NeonDocSnap> {
    const row = await this.trx.query.sophiaDocuments.findFirst({
      where: eq(sophiaDocuments.path, ref.path)
    });
    if (!row) return new NeonDocSnap(false, undefined, ref.id, ref);
    return new NeonDocSnap(true, row.data as Record<string, unknown>, ref.id, ref);
  }

  set(ref: NeonDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.writes.push(async () => {
      const enc = encodeFirestoreValue(data) as Record<string, unknown>;
      const row = await this.trx.query.sophiaDocuments.findFirst({
        where: eq(sophiaDocuments.path, ref.path)
      });
      const base = options?.merge
        ? { ...(row?.data as Record<string, unknown> | undefined), ...enc }
        : enc;
      const createdAtRaw = base.createdAt ?? base.created_at;
      let sort: Date | null = row?.sortCreatedAt ?? null;
      if (
        createdAtRaw &&
        typeof createdAtRaw === 'object' &&
        (createdAtRaw as { __fsTs?: boolean }).__fsTs
      ) {
        const ts = decodeFirestoreValue(createdAtRaw) as Timestamp;
        sort = ts.toDate();
      }
      await this.trx
        .insert(sophiaDocuments)
        .values({
          path: ref.path,
          topCollection: ref.top,
          data: base,
          sortCreatedAt: sort,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: sophiaDocuments.path,
          set: { data: base, sortCreatedAt: sort, updatedAt: new Date() }
        });
    });
  }

  update(ref: NeonDocRef, patch: Record<string, unknown>): void {
    this.writes.push(async () => {
      const row = await this.trx.query.sophiaDocuments.findFirst({
        where: eq(sophiaDocuments.path, ref.path)
      });
      const base = { ...(row?.data as Record<string, unknown> | undefined) };
      const decoded = decodeFirestoreValue(base) as Record<string, unknown>;
      applyFieldPatches(decoded, patch);
      const enc = encodeFirestoreValue(decoded) as Record<string, unknown>;
      await this.trx
        .insert(sophiaDocuments)
        .values({
          path: ref.path,
          topCollection: ref.top,
          data: enc,
          sortCreatedAt: row?.sortCreatedAt ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: sophiaDocuments.path,
          set: { data: enc, updatedAt: new Date() }
        });
    });
  }

  async flushWrites(): Promise<void> {
    for (const w of this.writes) await w();
  }
}

class NeonFirestoreCompat {
  collection(name: string): NeonCollectionRef {
    return new NeonCollectionRef(name, name);
  }

  runTransaction<T>(fn: (tx: NeonTransaction) => Promise<T>): Promise<T> {
    const db = getDrizzleDb();
    return db.transaction(async (trx) => {
      const tx = new NeonTransaction(trx);
      const out = await fn(tx);
      await tx.flushWrites();
      return out;
    });
  }
}

export function createNeonFirestoreCompat(): Firestore {
  return new NeonFirestoreCompat() as unknown as Firestore;
}
