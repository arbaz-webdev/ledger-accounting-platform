// Explicit operational step: never run automatically during build or migration.
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import "dotenv/config";
if (!process.argv.includes("--confirm")) throw new Error("Run with --confirm after creating and testing a real platform owner account.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const owner = await client.query("SELECT id FROM users WHERE role='platform_admin' AND is_active AND email NOT LIKE '%@demo.test' LIMIT 1");
  if (!owner.rows.length) throw new Error("Create a real active platform owner before retiring demo accounts.");
  const users = await client.query("SELECT id FROM users WHERE email LIKE '%@demo.test' FOR UPDATE");
  for (const user of users.rows) {
    const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    await client.query("UPDATE users SET is_active=false, password_hash=$1 WHERE id=$2", [hash, user.id]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [user.id]);
    await client.query("INSERT INTO audit_log(user_id,action,table_name,record_id) VALUES($1,'DEMO_ACCOUNT_RETIRED','users',$2)", [owner.rows[0].id, user.id]);
  }
  await client.query("COMMIT");
  console.log("Demo accounts retired:", users.rows.length);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
