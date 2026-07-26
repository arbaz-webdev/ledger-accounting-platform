import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;

/** An open transaction handle, as passed to a withTransaction callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a database transaction with REPEATABLE READ isolation
 * (spec 16.2 rule 10 — concurrent posting safety).
 */
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(fn, { isolationLevel: "repeatable read" });
}
