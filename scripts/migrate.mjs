// Simple forward-only SQL migration runner.
// Applies src/db/migrations/*.sql in filename order, tracking applied files
// in a _migrations table. Each migration runs in its own transaction.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "src", "db", "migrations");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query("SELECT filename FROM _migrations")).rows.map((r) => r.filename)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${file}: ${err.message}`);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) console.log("Migrations up to date.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
