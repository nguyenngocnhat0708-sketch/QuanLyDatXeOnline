const { getPool, sql, db } = require('../config/database');

class TicketModel {
  static async createTicket({ bookingId, ticketCode, confirmationToken, status = 'Hold' }, transaction) {
    if (db) {
      const ticketDoc = {
        ticketId: 'tk_' + ticketCode,
        bookingId,
        ticketCode,
        confirmationToken,
        status,
        createdAt: new Date().toISOString()
      };
      await db.collection('tickets').doc(ticketDoc.ticketId).set(ticketDoc);
      return {
        TicketID: ticketDoc.ticketId,
        TicketCode: ticketCode,
        ConfirmationToken: confirmationToken,
        Status: status
      };
    }

    const request = new sql.Request(transaction);
    request.input('bookingId', sql.Int, bookingId);
    request.input('ticketCode', sql.VarChar, ticketCode);
    request.input('confirmationToken', sql.VarChar, confirmationToken);
    request.input('status', sql.VarChar, status);

    const result = await request.query(`
      INSERT INTO dbo.Tickets (BookingID, TicketCode, ConfirmationToken, Status)
      OUTPUT INSERTED.TicketID, INSERTED.TicketCode, INSERTED.ConfirmationToken, INSERTED.Status
      VALUES (@bookingId, @ticketCode, @confirmationToken, @status);
    `);
    return result.recordset[0];
  }

  static async findByCode(ticketCode, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('tickets').where('ticketCode', '==', ticketCode).get();
        if (!snap.empty) {
          const tDoc = snap.docs[0].data();
          let bDoc = {};
          if (tDoc.bookingId) {
            const bSnap = await db.collection('bookings').doc(tDoc.bookingId).get();
            if (bSnap.exists) {
              bDoc = bSnap.data();
            } else {
              const bQuery = await db.collection('bookings').where('bookingCode', '==', tDoc.bookingId).get();
              if (!bQuery.empty) bDoc = bQuery.docs[0].data();
            }
          }
          const TripModel = require('./TripModel');
          const UserModel = require('./UserModel');
          const trip = await TripModel.findTripById(bDoc.tripId);
          const user = (await UserModel.findById(bDoc.userId)) || (await UserModel.findByPhone(bDoc.userId)) || {};
          return {
            TicketID: tDoc.ticketId || snap.docs[0].id,
            TicketCode: tDoc.ticketCode,
            TicketStatus: tDoc.status,
            ConfirmationToken: tDoc.confirmationToken,
            ConfirmedAt: tDoc.confirmedAt,
            CancelledAt: tDoc.cancelledAt,
            CancelReason: tDoc.cancelReason,
            BookingID: bDoc.bookingId,
            BookingCode: bDoc.bookingCode,
            TotalAmount: bDoc.totalAmount,
            SeatQuantity: bDoc.seatQuantity,
            UserID: bDoc.userId,
            FullName: tDoc.customerName || bDoc.customerName || user.FullName || '',
            PhoneNumber: tDoc.customerPhone || bDoc.customerPhone || user.PhoneNumber || '',
            Email: tDoc.customerEmail || bDoc.customerEmail || user.Email || '',
            TripID: trip ? trip.TripID : null,
            DepartureTime: trip ? trip.DepartureTime : null,
            ArrivalTime: trip ? trip.ArrivalTime : null,
            Origin: trip ? trip.Origin : '',
            Destination: trip ? trip.Destination : '',
            PlateNumber: trip ? trip.PlateNumber : '',
            BusType: trip ? trip.BusType : '',
            DriverName: trip ? trip.DriverName : ''
          };
        }
      } catch (err) {
        console.error('[TicketModel] Lỗi findByCode Firestore:', err.message);
      }
      return null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('ticketCode', sql.VarChar, ticketCode);

    const result = await request.query(`
      SELECT 
        tk.TicketID, tk.TicketCode, tk.Status AS TicketStatus, tk.ConfirmationToken,
        tk.ConfirmedAt, tk.CancelledAt, tk.CancelReason,
        b.BookingID, b.BookingCode, b.TotalAmount, b.SeatQuantity,
        u.UserID, u.FullName, u.PhoneNumber, u.Email,
        t.TripID, t.DepartureTime, t.ArrivalTime,
        r.Origin, r.Destination,
        bs.PlateNumber, bs.BusType,
        d.FullName AS DriverName
      FROM dbo.Tickets tk
      JOIN dbo.Bookings b ON tk.BookingID = b.BookingID
      JOIN dbo.Users u ON b.UserID = u.UserID
      JOIN dbo.Trips t ON b.TripID = t.TripID
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses bs ON t.BusID = bs.BusID
      JOIN dbo.Users d ON t.DriverID = d.UserID
      WHERE tk.TicketCode = @ticketCode;
    `);
    return result.recordset[0] || null;
  }

  static async findTicketsByUserId(userId) {
    if (db) {
      try {
        const UserModel = require('./UserModel');
        const user = (await UserModel.findById(userId)) || (await UserModel.findByPhone(userId));
        const searchIds = [String(userId)];
        if (user) {
          if (user.UserID) searchIds.push(String(user.UserID));
          if (user.PhoneNumber) searchIds.push(String(user.PhoneNumber));
        }
        const uniqueIds = Array.from(new Set(searchIds));

        let bookings = [];
        const bSnap = await db.collection('bookings').where('userId', 'in', uniqueIds).get();
        bSnap.forEach(d => bookings.push(d.data()));

        if (user && user.PhoneNumber) {
          const bPhoneSnap = await db.collection('bookings').where('customerPhone', '==', user.PhoneNumber).get();
          bPhoneSnap.forEach(d => {
            if (!bookings.some(b => b.bookingId === d.data().bookingId)) {
              bookings.push(d.data());
            }
          });
        }

        const list = [];
        const TripModel = require('./TripModel');
        for (const bDoc of bookings) {
          const tSnap = await db.collection('tickets').where('bookingId', '==', bDoc.bookingId).get();
          const trip = await TripModel.findTripById(bDoc.tripId);
          tSnap.forEach(doc => {
            const tDoc = doc.data();
            list.push({
              TicketID: tDoc.ticketId || doc.id,
              TicketCode: tDoc.ticketCode,
              TicketStatus: tDoc.status,
              BookingID: bDoc.bookingId,
              BookingCode: bDoc.bookingCode,
              TotalAmount: bDoc.totalAmount,
              SeatQuantity: bDoc.seatQuantity,
              TripID: trip ? trip.TripID : null,
              DepartureTime: trip ? trip.DepartureTime : null,
              ArrivalTime: trip ? trip.ArrivalTime : null,
              Origin: trip ? trip.Origin : '',
              Destination: trip ? trip.Destination : '',
              PlateNumber: trip ? trip.PlateNumber : '',
              BusType: trip ? trip.BusType : '',
              DriverName: trip ? trip.DriverName : ''
            });
          });
        }
        return list;
      } catch (err) {
        console.error('[TicketModel] Lỗi findTicketsByUserId Firestore:', err.message);
        return [];
      }
    }

    const pool = getPool();
    const request = pool.request();
    request.input('userId', sql.Int, userId);

    const result = await request.query(`
      SELECT 
        tk.TicketID, tk.TicketCode, tk.Status AS TicketStatus,
        tk.ConfirmedAt, tk.CancelledAt, tk.CancelReason,
        b.BookingID, b.BookingCode, b.TotalAmount, b.SeatQuantity,
        u.FullName, u.PhoneNumber, u.Email,
        t.TripID, t.DepartureTime, t.ArrivalTime,
        r.Origin, r.Destination,
        bs.PlateNumber, bs.BusType,
        d.FullName AS DriverName
      FROM dbo.Tickets tk
      JOIN dbo.Bookings b ON tk.BookingID = b.BookingID
      JOIN dbo.Users u ON b.UserID = u.UserID
      JOIN dbo.Trips t ON b.TripID = t.TripID
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses bs ON t.BusID = bs.BusID
      JOIN dbo.Users d ON t.DriverID = d.UserID
      WHERE b.UserID = @userId
      ORDER BY tk.TicketID DESC;
    `);
    return result.recordset;
  }

  static async findByConfirmationToken(token, transaction = null) {
    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('token', sql.VarChar, token);

    const result = await request.query(`
      SELECT 
        tk.TicketID, tk.TicketCode, tk.Status, tk.ConfirmationToken,
        b.BookingID, b.BookingCode,
        t.TripID, t.DepartureTime
      FROM dbo.Tickets tk
      JOIN dbo.Bookings b ON tk.BookingID = b.BookingID
      JOIN dbo.Trips t ON b.TripID = t.TripID
      WHERE tk.ConfirmationToken = @token;
    `);
    return result.recordset[0] || null;
  }

  static async findPassengersByTrip(tripId) {
    if (db) {
      try {
        const tripNum = Number(tripId);
        const tripStr = String(tripId);
        const tripPrefixed = tripStr.startsWith('trip_') ? tripStr : `trip_${tripStr}`;
        const tripUnprefixed = tripStr.replace('trip_', '');
        const searchIds = Array.from(new Set([tripNum, tripStr, tripPrefixed, Number(tripUnprefixed)]));

        const bSnap = await db.collection('bookings').where('tripId', 'in', searchIds).get();
        const list = [];
        const UserModel = require('./UserModel');
        for (const bDocSnap of bSnap.docs) {
          const bDoc = bDocSnap.data();
          const tSnap = await db.collection('tickets').where('bookingId', '==', bDoc.bookingId).get();
          const user = (await UserModel.findById(bDoc.userId)) || (await UserModel.findByPhone(bDoc.userId)) || {};
          const passengerName = bDoc.customerName || user.FullName || 'Khách hàng';
          const passengerPhone = bDoc.customerPhone || user.PhoneNumber || '';
          const passengerEmail = bDoc.customerEmail || user.Email || '';

          tSnap.forEach(doc => {
            const tDoc = doc.data();
            list.push({
              TicketID: tDoc.ticketId || doc.id,
              TicketCode: tDoc.ticketCode,
              TicketStatus: tDoc.status,
              CancelReason: tDoc.cancelReason,
              ConfirmedAt: tDoc.confirmedAt,
              BookingCode: bDoc.bookingCode,
              PassengerName: tDoc.customerName || passengerName,
              PassengerPhone: tDoc.customerPhone || passengerPhone,
              PassengerEmail: tDoc.customerEmail || passengerEmail
            });
          });
        }
        return list;
      } catch (err) {
        console.error('[TicketModel] Lỗi findPassengersByTrip Firestore:', err.message);
        return [];
      }
    }

    const pool = getPool();
    const request = pool.request();
    request.input('tripId', sql.Int, tripId);

    const result = await request.query(`
      SELECT 
        tk.TicketID, tk.TicketCode, tk.Status AS TicketStatus, tk.CancelReason, tk.ConfirmedAt,
        b.BookingCode,
        u.FullName AS PassengerName, u.PhoneNumber AS PassengerPhone, u.Email AS PassengerEmail
      FROM dbo.Tickets tk
      JOIN dbo.Bookings b ON tk.BookingID = b.BookingID
      JOIN dbo.Users u ON b.UserID = u.UserID
      WHERE b.TripID = @tripId
      ORDER BY 
        CASE WHEN tk.Status = 'NoReply' THEN 1 ELSE 2 END,
        tk.TicketID ASC;
    `);
    return result.recordset;
  }

  static async updateStatus(ticketCode, status, reason = null, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('tickets').where('ticketCode', '==', ticketCode).get();
        if (!snap.empty) {
          const data = { status };
          if (status === 'Confirmed') data.confirmedAt = new Date().toISOString();
          if (status === 'Cancelled') {
            data.cancelReason = reason;
            data.cancelledAt = new Date().toISOString();
          }
          await snap.docs[0].ref.update(data);
        }
      } catch (err) {
        console.error('[TicketModel] Lỗi updateStatus Firestore:', err.message);
      }
      return;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('ticketCode', sql.VarChar, ticketCode);
    request.input('status', sql.VarChar, status);
    request.input('reason', sql.NVarChar, reason);

    let query = `
      UPDATE dbo.Tickets
      SET Status = @status
    `;

    if (status === 'Confirmed') {
      query += `, ConfirmedAt = SYSUTCDATETIME()`;
    } else if (status === 'Cancelled') {
      query += `, CancelReason = @reason, CancelledAt = SYSUTCDATETIME()`;
    }

    query += ` WHERE TicketCode = @ticketCode;`;

    await request.query(query);
  }

  static async updateStatusByBookingId(bookingId, fromStatus, toStatus, transaction = null) {
    if (db) {
      try {
        const snap = await db.collection('tickets').where('bookingId', '==', bookingId).get();
        for (const doc of snap.docs) {
          if (!fromStatus || doc.data().status === fromStatus) {
            await doc.ref.update({ status: toStatus });
          }
        }
      } catch (err) {
        console.error('[TicketModel] Lỗi updateStatusByBookingId Firestore:', err.message);
      }
      return;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('bookingId', sql.Int, bookingId);
    request.input('fromStatus', sql.VarChar, fromStatus);
    request.input('toStatus', sql.VarChar, toStatus);

    await request.query(`
      UPDATE dbo.Tickets
      SET Status = @toStatus
      WHERE BookingID = @bookingId AND Status = @fromStatus;
    `);
  }
}

module.exports = TicketModel;
