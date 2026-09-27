// Explicit bootstrap step; credentials come from private environment variables.
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";
const email = (process.env.PLATFORM_OWNER_EMAIL ?? "").trim().toLowerCase();
const name = (process.env.PLATFORM_OWNER_NAME ?? "").trim();
const password = process.env.PLATFORM_OWNER_PASSWORD ?? "";
if (!email.includes("@") || email.endsWith("@demo.test") || !name ||
    password.length < 12 || Buffer.byteLength(password) > 72) {
  throw new Error("Set PLATFORM_OWNER_EMAIL (non-demo), PLATFORM_OWNER_NAME and PLATFORM_OWNER_PASSWORD (12+ characters; <=72 UTF-8 bytes).");
}
const hash = await bcrypt.hash(password, 12);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const result = await client.query(
    "INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,'platform_admin') RETURNING id",
    [email, hash, name]
  );
  await client.query("INSERT INTO audit_log(user_id,action,table_name,record_id) VALUES($1,'PLATFORM_OWNER_CREATED','users',$1)",
    [result.rows[0].id]);
  await client.query("COMMIT");
  console.log("Platform owner created. Sign in and enroll MFA; the password was not logged.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
