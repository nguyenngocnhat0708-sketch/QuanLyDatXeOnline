// backend/src/config/database.js
const sql = require('mssql');
const config = require('./environment');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. CẤU HÌNH MICROSOFT SQL SERVER
// ==========================================
let pool = null;

async function connectDatabase() {
  if (pool) return pool;

  try {
    pool = await sql.connect(config.db);
    console.log(`[MSSQL] Successfully connected to database: ${config.db.database} at ${config.db.server}:${config.db.port}`);
    return pool;
  } catch (error) {
    console.warn('[MSSQL] Không thể kết nối cơ sở dữ liệu SQL Server:', error.message);
    // Nếu đang chạy trên Cloud (Render) hoặc đã có Firebase thì không crash server
    if (process.env.NODE_ENV === 'production' || process.env.RENDER || db) {
      console.log('[Database] Môi trường Cloud / Firebase: Tiếp tục khởi động server không cần MSSQL.');
      return null;
    }
    throw error;
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call connectDatabase() first.');
  }
  return pool;
}

// ==========================================
// 2. CẤU HÌNH GOOGLE FIREBASE FIRESTORE
// ==========================================
const secretPath = process.env.FIREBASE_KEY_PATH || path.join(__dirname, 'serviceAccountKey.json');

let db = null;

try {
  let serviceAccount = null;

  // Cách 1: Đọc từ biến môi trường FIREBASE_CONFIG_JSON trên Render (Tiện lợi nhất)
  if (process.env.FIREBASE_CONFIG_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
  }
  // Cách 2: Đọc từ file vật lý cục bộ hoặc Secret File Render
  else if (fs.existsSync(secretPath)) {
    serviceAccount = require(secretPath);
  } else if (fs.existsSync('/etc/secrets/serviceAccountKey.json')) {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
  }

  if (serviceAccount) {
    const existingApps = (typeof admin.getApps === 'function' ? admin.getApps() : admin.apps) || [];
    if (existingApps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    console.log('[Firebase] Đã khởi tạo kết nối Cloud Firestore thành công.');
  } else {
    console.warn('[Firebase] Chưa tìm thấy cấu hình Firebase (FIREBASE_CONFIG_JSON hoặc serviceAccountKey.json).');
  }
} catch (err) {
  console.error('[Firebase] Lỗi khởi tạo kết nối Firebase:', err.message);
}

// ==========================================
// 3. EXPORT ĐẦY ĐỦ CẢ HAI HỆ THỐNG
// ==========================================
module.exports = {
  // Xuất MSSQL cho các chức năng cũ
  sql,
  connectDatabase,
  getPool,
  // Xuất Firebase cho các chức năng đám mây
  admin,
  db
};

