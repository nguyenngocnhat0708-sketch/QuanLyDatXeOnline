const { getPool, sql, db } = require('../config/database');

class BookingModel {
  static async createBooking({ bookingCode, userId, tripId, seatQuantity, totalAmount }, transaction) {
    if (db) {
      const doc = {
        bookingId: 'bk_' + bookingCode,
        bookingCode,
        userId,
        tripId,
        seatQuantity,
        totalAmount,
        status: 'Pending',
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      };
      await db.collection('bookings').doc(doc.bookingId).set(doc);
      return {
        BookingID: doc.bookingId,
        BookingCode: doc.bookingCode,
        HoldExpiresAt: doc.holdExpiresAt,
        TotalAmount: doc.totalAmount,
        SeatQuantity: doc.seatQuantity
      };
    }

    const request = new sql.Request(transaction);
    request.input('bookingCode', sql.VarChar, bookingCode);
    request.input('userId', sql.Int, userId);
    request.input('tripId', sql.Int, tripId);
    request.input('seatQuantity', sql.Int, seatQuantity);
    request.input('totalAmount', sql.Decimal(18, 2), totalAmount);

    const result = await request.query(`
      INSERT INTO dbo.Bookings (BookingCode, UserID, TripID, SeatQuantity, TotalAmount, Status, HoldExpiresAt)
      OUTPUT INSERTED.BookingID, INSERTED.BookingCode, INSERTED.HoldExpiresAt, INSERTED.TotalAmount, INSERTED.SeatQuantity
      VALUES (@bookingCode, @userId, @tripId, @seatQuantity, @totalAmount, 'Pending', DATEADD(MINUTE, 10, SYSUTCDATETIME()));
    `);
    return result.recordset[0];
  }

  static async findByCode(bookingCode, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('bookings').where('bookingCode', '==', bookingCode).get();
        if (!snap.empty) {
          const bDoc = snap.docs[0].data();
          const TripModel = require('./TripModel');
          const UserModel = require('./UserModel');
          const trip = await TripModel.findTripById(bDoc.tripId);
          const user = (await UserModel.findById(bDoc.userId)) || (await UserModel.findByPhone(bDoc.userId)) || {};
          return {
            BookingID: bDoc.bookingId || snap.docs[0].id,
            BookingCode: bDoc.bookingCode,
            SeatQuantity: bDoc.seatQuantity,
            TotalAmount: bDoc.totalAmount,
            Status: bDoc.status || 'Pending',
            HoldExpiresAt: bDoc.holdExpiresAt,
            CreatedAt: bDoc.createdAt,
            FullName: user.FullName || '',
            PhoneNumber: user.PhoneNumber || '',
            Email: user.Email || '',
            DepartureTime: trip ? trip.DepartureTime : '',
            ArrivalTime: trip ? trip.ArrivalTime : '',
            BasePrice: trip ? trip.BasePrice : 0,
            Origin: trip ? trip.Origin : '',
            Destination: trip ? trip.Destination : '',
            PlateNumber: trip ? trip.PlateNumber : '',
            BusType: trip ? trip.BusType : '',
            DriverName: trip ? trip.DriverName : ''
          };
        }
      } catch (err) {
        console.error('[BookingModel] Lỗi findByCode Firestore:', err.message);
      }
      return null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('bookingCode', sql.VarChar, bookingCode);

    const result = await request.query(`
      SELECT 
        b.BookingID, b.BookingCode, b.SeatQuantity, b.TotalAmount, b.Status, b.HoldExpiresAt, b.CreatedAt,
        u.FullName, u.PhoneNumber, u.Email,
        t.DepartureTime, t.ArrivalTime, t.BasePrice,
        r.Origin, r.Destination,
        bs.PlateNumber, bs.BusType,
        d.FullName AS DriverName
      FROM dbo.Bookings b
      JOIN dbo.Users u ON b.UserID = u.UserID
      JOIN dbo.Trips t ON b.TripID = t.TripID
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses bs ON t.BusID = bs.BusID
      JOIN dbo.Users d ON t.DriverID = d.UserID
      WHERE b.BookingCode = @bookingCode;
    `);
    return result.recordset[0] || null;
  }

  static async updateStatus(bookingId, status, transaction = null) {
    if (db) {
      try {
        let docRef = db.collection('bookings').doc(String(bookingId));
        let snap = await docRef.get();
        if (!snap.exists) {
          const q = await db.collection('bookings').where('bookingCode', '==', bookingId).get();
          if (!q.empty) {
            docRef = q.docs[0].ref;
            snap = q.docs[0];
          }
        }
        if (snap.exists) {
          await docRef.update({ status, updatedAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error('[BookingModel] Lỗi updateStatus Firestore:', err.message);
      }
      return;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('bookingId', sql.Int, bookingId);
    request.input('status', sql.VarChar, status);

    await request.query(`
      UPDATE dbo.Bookings
      SET Status = @status, UpdatedAt = SYSUTCDATETIME()
      WHERE BookingID = @bookingId;
    `);
  }
}

module.exports = BookingModel;
