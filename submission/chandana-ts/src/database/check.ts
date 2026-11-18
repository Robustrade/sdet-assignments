import db from './connection';

const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table'
  ORDER BY name
`).all();

console.log('Database tables:', tables);

db.close();