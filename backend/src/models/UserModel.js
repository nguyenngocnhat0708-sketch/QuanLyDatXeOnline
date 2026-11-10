const { getPool, sql, db } = require('../config/database');

function mapFirestoreUser(doc) {
  const data = doc.data ? doc.data() : doc;
  return {
    UserID: data.UserID || data.userId || (doc.id ? doc.id : 'usr_1'),
    Role: data.Role || data.role || 'Customer',
    FullName: data.FullName || data.fullName || '',
    PhoneNumber: data.PhoneNumber || data.phoneNumber || '',
    Email: data.Email || data.email || '',
    PasswordHash: data.PasswordHash || data.passwordHash || '',
    CreatedAt: data.CreatedAt || data.createdAt || new Date().toISOString()
  };
}

class UserModel {
  static async findById(userId) {
    if (db) {
      try {
        const docRef = db.collection('users').doc(String(userId));
        const snap = await docRef.get();
        if (snap.exists) {
          return mapFirestoreUser(snap);
        }
        const q = await db.collection('users').where('userId', '==', String(userId)).get();
        if (!q.empty) {
          return mapFirestoreUser(q.docs[0]);
        }
      } catch (err) {
        console.error('[UserModel] Lỗi findById từ Firestore:', err.message);
      }
      return null;
    }

    const pool = getPool();
    const request = pool.request();
    request.input('userId', sql.Int, userId);
    const result = await request.query(`
      SELECT UserID, Role, FullName, PhoneNumber, Email, PasswordHash, CreatedAt
      FROM dbo.Users
      WHERE UserID = @userId;
    `);
    return result.recordset[0] || null;
  }

  static async findByPhone(phoneNumber, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('users').where('phoneNumber', '==', phoneNumber).get();
        if (!snap.empty) {
          return mapFirestoreUser(snap.docs[0]);
        }
      } catch (err) {
        console.error('[UserModel] Lỗi findByPhone từ Firestore:', err.message);
      }
      return null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('phoneNumber', sql.VarChar, phoneNumber);

    const result = await request.query(`
      SELECT UserID, Role, FullName, PhoneNumber, Email, PasswordHash, CreatedAt
      FROM dbo.Users
      WHERE PhoneNumber = @phoneNumber;
    `);
    return result.recordset[0] || null;
  }

  static async findByPhoneAndRole(phoneNumber, role) {
    if (db) {
      try {
        const snap = await db.collection('users')
          .where('phoneNumber', '==', phoneNumber)
          .where('role', '==', role)
          .get();
        if (!snap.empty) {
          return mapFirestoreUser(snap.docs[0]);
        }
      } catch (err) {
        console.error('[UserModel] Lỗi findByPhoneAndRole từ Firestore:', err.message);
      }
      return null;
    }

    const pool = getPool();
    const request = pool.request();
    request.input('phoneNumber', sql.VarChar, phoneNumber);
    request.input('role', sql.VarChar, role);

    const result = await request.query(`
      SELECT UserID, Role, FullName, PhoneNumber, Email, PasswordHash, CreatedAt
      FROM dbo.Users
      WHERE PhoneNumber = @phoneNumber AND Role = @role;
    `);
    return result.recordset[0] || null;
  }

  static async upsertCustomer({ fullName, phoneNumber, email }, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('users').where('phoneNumber', '==', phoneNumber).get();
        if (!snap.empty) {
          const docRef = snap.docs[0].ref;
          await docRef.update({ fullName, email, updatedAt: new Date().toISOString() });
          const updated = await docRef.get();
          return mapFirestoreUser(updated);
        } else {
          const newUser = {
            userId: 'usr_' + Date.now(),
            role: 'Customer',
            fullName,
            phoneNumber,
            email,
            createdAt: new Date().toISOString()
          };
          const ref = await db.collection('users').add(newUser);
          newUser.UserID = ref.id;
          return mapFirestoreUser(newUser);
        }
      } catch (err) {
        console.error('[UserModel] Lỗi upsertCustomer trên Firestore:', err.message);
      }
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('role', sql.VarChar, 'Customer');
    request.input('fullName', sql.NVarChar, fullName);
    request.input('phoneNumber', sql.VarChar, phoneNumber);
    request.input('email', sql.VarChar, email);

    const result = await request.query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE PhoneNumber = @phoneNumber)
      BEGIN
          INSERT INTO dbo.Users (Role, FullName, PhoneNumber, Email)
          VALUES (@role, @fullName, @phoneNumber, @email);
      END
      ELSE
      BEGIN
          UPDATE dbo.Users
          SET FullName = @fullName, Email = @email, UpdatedAt = SYSUTCDATETIME()
          WHERE PhoneNumber = @phoneNumber;
      END

      SELECT UserID, Role, FullName, PhoneNumber, Email FROM dbo.Users WHERE PhoneNumber = @phoneNumber;
    `);
    return result.recordset[0];
  }
}

module.exports = UserModel;

