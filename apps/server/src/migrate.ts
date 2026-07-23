import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nije podešen.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
await pool.query(`DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='departments' AND column_name='code'
  ) THEN
    ALTER TABLE departments ALTER COLUMN code
      SET DEFAULT ('SEK-' || upper(substr(md5(random()::text), 1, 8)));
  END IF;
END $$`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations");
const files = (await readdir(root)).filter((file) => file.endsWith(".sql")).sort();
const appliedResult=await pool.query("SELECT version FROM schema_migrations");
const applied=new Set(appliedResult.rows.map(row=>Number(row.version)));
for (const file of files) {
  const version=Number(file.slice(0,3));
  if(applied.has(version))continue;
  const sql = await readFile(path.join(root, file), "utf8");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT(version) DO NOTHING",[version]);
    await client.query("COMMIT");
    applied.add(version);
    process.stdout.write(`Primena migracije: ${file}\n`);
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
await pool.end();
