
import Database from 'better-sqlite3';
import { schema } from './schema';

export function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(schema);
  return database;
}

const db = createDatabase();

export default db;
