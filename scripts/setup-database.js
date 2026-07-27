// SQLite database setup
// Database is automatically initialized when DatabaseHelper is instantiated
// No manual setup required!

const DatabaseHelper = require('../utils/databaseHelper');

async function setupDatabase() {
  try {
    console.log('Setting up SQLite database...');
    
    // Create database instance (will auto-create schema)
    const dbHelper = new DatabaseHelper();
    
    // Test connection
    const testResult = await dbHelper.testConnection();
    
    if (testResult.success) {
      console.log('✓ Database setup completed successfully!');
      console.log('✓ Timestamp:', testResult.timestamp);
      console.log('\nTables created:');
      console.log('  - wallets');
      console.log('  - transfers');
      console.log('  - idempotency_keys');
      console.log('  - transfer_events');
      console.log('  - outbox_events');
      console.log('  - audit_logs');
      console.log('\n✓ SQLite database is ready to use!');
      console.log('✓ No PostgreSQL installation required!');
    } else {
      console.error('✗ Database setup failed:', testResult.error);
      process.exit(1);
    }
    
    dbHelper.close();
    process.exit(0);
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  }
}

setupDatabase();
