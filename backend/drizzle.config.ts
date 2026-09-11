import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Custom trigger/function migrations (0001_integrity_triggers.sql and any future ones)
  // are written by hand via `drizzle-kit generate --custom` and live in the same `out`
  // directory, applied in order by `drizzle-kit migrate`. Never use `drizzle-kit push`.
} satisfies Config;
