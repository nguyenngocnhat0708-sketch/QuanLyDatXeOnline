// backend/src/config/database.js
const sql = require('mssql');
const config = require('./environment');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. CẤU HÌNH MICROSOFT SQL SERVER (GIỮ NGUYÊN)
// ==========================================
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

// ==========================================
// 2. CẤU HÌNH GOOGLE FIREBASE (BỔ SUNG THÊM)
// ==========================================
const secretPath = process.env.FIREBASE_KEY_PATH || path.join(__dirname, 'serviceAccountKey.json');

let db = null;

if (!admin.apps.length) {
  if (fs.existsSync(secretPath)) {
    try {
      const serviceAccount = require(secretPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      console.log('[Firebase] Đã khởi tạo kết nối Cloud Firestore thành công.');
    } catch (err) {
      console.error('[Firebase] Lỗi khi đọc file cấu hình khóa:', err.message);
    }
  } else {
    console.warn('[Firebase] Chưa thấy file serviceAccountKey.json trong thư mục config (Bỏ qua nếu chỉ đang chạy SQL Server cục bộ).');
  }
} else {
  db = admin.firestore();
}

// ==========================================
// 3. EXPORT ĐẦY ĐỦ CẢ HAI HỆ THỐNG
// ==========================================
module.exports = {
  // Xuất MSSQL cho các Model hiện tại hoạt động bình thường
  sql,
  connectDatabase,
  getPool,
  // Xuất Firebase cho script seed và các tác vụ NoSQL
  admin,
  db
};

