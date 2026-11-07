const sql = require('mssql');
const config = require('./environment');

let pool = null;

async function connectDatabase() {
  if (pool) return pool;

  try {
    pool = await sql.connect(config.db);
    console.log(`[MSSQL] Successfully connected to database: ${config.db.database} at ${config.db.server}:${config.db.port}`);
    return pool;
  } catch (error) {
    console.error('[MSSQL] Connection failed:', error.message);
    throw error;
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call connectDatabase() first.');
  }
  return pool;
}

module.exports = {
  sql,
  connectDatabase,
  getPool
};

