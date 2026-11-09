import { defineConfig } from "drizzle-kit";
// `drizzle-kit generate` needs no database. `drizzle-kit migrate` targets DATABASE_URL (Postgres); PGlite migrates itself at boot.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/punchlist" },
  strict: true,
  verbose: false,
});
