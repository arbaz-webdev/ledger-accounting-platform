// Test fixture: a second firm + entity, to verify cross-firm tenancy isolation.
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const hash = await bcrypt.hash("demo1234", 12);

const firm =
  (
    await c.query(
      `INSERT INTO firms (name) SELECT 'Rival Accounting Firm'
       WHERE NOT EXISTS (SELECT 1 FROM firms WHERE name='Rival Accounting Firm') RETURNING id`
    )
  ).rows[0] ?? (await c.query(`SELECT id FROM firms WHERE name='Rival Accounting Firm'`)).rows[0];

await c.query(
  `INSERT INTO users (firm_id,email,password_hash,full_name,role)
   VALUES ($1,'rival@demo.test',$2,'Rival Accountant','firm_admin')
   ON CONFLICT (email) DO NOTHING`,
  [firm.id, hash]
);

const ent =
  (
    await c.query(
      `INSERT INTO entities (firm_id,name,base_currency) SELECT $1,'Rival Client Co','EUR'
       WHERE NOT EXISTS (SELECT 1 FROM entities WHERE name='Rival Client Co') RETURNING id`,
      [firm.id]
    )
  ).rows[0] ?? (await c.query(`SELECT id FROM entities WHERE name='Rival Client Co'`)).rows[0];

console.log("Rival firm id:  ", firm.id);
console.log("Rival entity id:", ent.id);
console.log("Rival login: rival@demo.test / demo1234");
await c.end();
