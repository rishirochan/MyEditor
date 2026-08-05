import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  // db:migrate keeps its bookkeeping in the `drizzle` schema, which push leaves
  // alone. Databases created before that move still have it in `public`, where
  // push would drop it as a stray table — costing the migration history.
  tablesFilter: ["*", "!__drizzle_migrations"],
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://backslash:devpassword@localhost:5432/backslash",
  },
});
