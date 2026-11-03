import { QueryResult, QueryResultRow } from "pg";

import { getDbPool } from "./db-client";

export async function executeQuery<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  try {
    return await getDbPool().query<T>(sql, values);
  } catch (error) {
    console.error("Database query execution failed:", error);
    throw error;
  }
}
