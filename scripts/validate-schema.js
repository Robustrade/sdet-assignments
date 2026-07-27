const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'wallet_transfer_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const requiredTables = [
  'wallets',
  'transfers',
  'idempotency_keys',
  'transfer_events',
  'outbox_events',
  'audit_logs',
];

async function validateSchema() {
  let client;
  try {
    console.log('Connecting to database...');
    client = await pool.connect();
    
    console.log('Validating database schema...\n');
    
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    
    const existingTables = result.rows.map(row => row.table_name);
    
    let allTablesExist = true;
    
    for (const table of requiredTables) {
      if (existingTables.includes(table)) {
        console.log(`✓ Table '${table}' exists`);
      } else {
        console.log(`✗ Table '${table}' is missing`);
        allTablesExist = false;
      }
    }
    
    console.log('\n--- Column Validation ---\n');
    
    const walletColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'wallets'
    `);
    console.log('Wallets table columns:', walletColumns.rows.length);
    
    const transferColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'transfers'
    `);
    console.log('Transfers table columns:', transferColumns.rows.length);
    
    const idempotencyColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'idempotency_keys'
    `);
    console.log('Idempotency_keys table columns:', idempotencyColumns.rows.length);
    
    console.log('\n--- Index Validation ---\n');
    
    const indexes = await client.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public'
    `);
    console.log(`Total indexes: ${indexes.rows.length}`);
    
    console.log('\n--- Constraint Validation ---\n');
    
    const constraints = await client.query(`
      SELECT conname, contype, conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
    `);
    console.log(`Total constraints: ${constraints.rows.length}`);
    
    if (allTablesExist) {
      console.log('\n✓ Schema validation passed!');
      process.exit(0);
    } else {
      console.log('\n✗ Schema validation failed!');
      console.log('Run: npm run setup:db');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Error validating schema:', error);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

validateSchema();
