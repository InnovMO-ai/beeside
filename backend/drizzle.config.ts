import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Pinned explicitly (these are drizzle-kit's defaults) so the tracking table's location
  // never silently moves: every environment records applied migrations here.
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  // Custom migrations (0001_integrity_triggers.sql, 0002_config_seed.sql and any future
  // ones) are written by hand via `drizzle-kit generate --custom` and live in the same `out`
  // directory, applied in order by `drizzle-kit migrate`. Never use `drizzle-kit push`.
} satisfies Config;
