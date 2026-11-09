// Drizzle database handle. Owner: lib/db.
// DATABASE_URL set → node-postgres. Otherwise → PGlite persisted under PGLITE_DIR (default ./data/pglite).
// Both run the same SQL migrations from ./drizzle at boot and seed when the contractors table is empty.
// A globalThis singleton survives Next.js HMR so PGlite is never opened twice in one process (that corrupts the data dir).
import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env } from "@/lib/config";
import { schema, type Schema } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type DbDriver = "postgres" | "pglite";

interface Holder { promise?: Promise<Db>; db?: Db; driver?: DbDriver }
const g = globalThis as typeof globalThis & { __punchlistDb?: Holder };
function holder(): Holder { if (!g.__punchlistDb) g.__punchlistDb = {}; return g.__punchlistDb; }

export function dbDriver(): DbDriver { return env.databaseUrl ? "postgres" : "pglite"; }

async function init(seed: boolean): Promise<Db> {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  let db: Db;
  if (env.databaseUrl) {
    const [{ drizzle }, { migrate }, { Pool }] = await Promise.all([
      import("drizzle-orm/node-postgres"), import("drizzle-orm/node-postgres/migrator"), import("pg"),
    ]);
    const pool = new Pool({ connectionString: env.databaseUrl, max: 5 });
    const pgDb = drizzle({ client: pool, schema });
    await migrate(pgDb, { migrationsFolder });
    db = pgDb as unknown as Db;
  } else {
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import("@electric-sql/pglite"), import("drizzle-orm/pglite"), import("drizzle-orm/pglite/migrator"),
    ]);
    fs.mkdirSync(env.pgliteDir, { recursive: true });
    const client = new PGlite(env.pgliteDir);
    const liteDb = drizzle({ client, schema });
    await migrate(liteDb, { migrationsFolder });
    db = liteDb as unknown as Db;
  }
  if (seed) { const { seedIfEmpty } = await import("@/db/seed"); await seedIfEmpty(db); }
  holder().driver = dbDriver();
  return db;
}

/** Opens the database once per process, runs migrations, and seeds when empty (unless `seed: false`). */
export async function getDb(opts: { seed?: boolean } = {}): Promise<Db> {
  const h = holder();
  if (h.db) return h.db;
  if (!h.promise) {
    h.promise = init(opts.seed ?? true)
      .then((db) => { h.db = db; return db; })
      .catch((err) => { h.promise = undefined; throw err; });
  }
  return h.promise;
}

export async function ensureDb(opts: { seed?: boolean } = {}): Promise<void> { await getDb(opts); }

/** Closes the underlying client (tests and CLI scripts). Next.js never calls this. */
export async function closeDb(): Promise<void> {
  const h = holder();
  if (!h.db) return;
  const client = (h.db as unknown as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } }).$client;
  if (client?.end) await client.end(); else if (client?.close) await client.close();
  g.__punchlistDb = {};
}
