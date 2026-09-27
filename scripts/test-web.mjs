import { spawnSync } from "node:child_process";

// Uses the integration suite's disposable PostgreSQL cluster, not .env.
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/database.test.ts"], {
  env: { ...process.env, LEDGER_HTTP_SMOKE: "1" }, stdio: "inherit", windowsHide: true,
});
process.exit(result.status ?? 1);
