import { Pool } from "pg";
import { env } from "../config/env";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    database: env.database.name,
    user: env.database.user,
    password: env.database.password,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
  });

  return pool;
}

export async function closeDbConnection(): Promise<void> {
  if (pool) {
    const currentPool = pool;
    pool = null;
    await currentPool.end();
  }
}
