import pg from "pg";

const { Pool } = pg;
pg.types.setTypeParser(1082, value => value);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nije podešen. PostgreSQL je obavezan.");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function closeDatabase() {
  await pool.end();
}
