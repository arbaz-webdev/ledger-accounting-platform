// Local dev database controller.
// Usage: node scripts/db.mjs start|stop|status
// Uses embedded-postgres binaries; the server is started via pg_ctl so it
// detaches and keeps running after this script exits. Data lives in .pgdata/.
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataDir = path.join(root, ".pgdata");
const binDir = path.join(root, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const pgCtl = path.join(binDir, "pg_ctl.exe");
const logFile = path.join(dataDir, "postgres.log");

const PORT = 5433;
const USER = "accounting";
const PASSWORD = "accounting_dev";
const DBNAME = "accounting";

function ctl(args, opts = {}) {
  return execFileSync(pgCtl, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function isRunning() {
  try {
    ctl(["status", "-D", dataDir]);
    return true;
  } catch {
    return false;
  }
}

const cmd = process.argv[2] ?? "start";

if (cmd === "start") {
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) {
    console.log("Initialising new PostgreSQL cluster in .pgdata/ ...");
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: USER,
      password: PASSWORD,
      port: PORT,
      persistent: true,
    });
    await pg.initialise();
  }

  if (isRunning()) {
    console.log(`PostgreSQL already running on port ${PORT}.`);
    process.exit(0);
  }

  // stdio must be fully detached or the spawned server inherits this shell's
  // pipes and keeps callers hanging after the script exits
  ctl(["start", "-D", dataDir, "-l", logFile, "-o", `-p ${PORT}`, "-w"], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  // Ensure the application database exists (psql is not bundled; use the driver)
  const client = new pg.Client({
    host: "localhost",
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: "postgres",
  });
  await client.connect();
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DBNAME]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE ${DBNAME}`);
    console.log(`Created database '${DBNAME}'.`);
  }
  await client.end();

  console.log(`PostgreSQL running on port ${PORT} (user: ${USER}, db: ${DBNAME}).`);
  console.log("Stop it with: npm run db:stop");
} else if (cmd === "stop") {
  if (!isRunning()) {
    console.log("PostgreSQL is not running.");
  } else {
    ctl(["stop", "-D", dataDir, "-m", "fast", "-w"]);
    console.log("PostgreSQL stopped.");
  }
} else if (cmd === "status") {
  console.log(isRunning() ? "running" : "stopped");
} else {
  console.error(`Unknown command: ${cmd} (use start|stop|status)`);
  process.exit(1);
}
