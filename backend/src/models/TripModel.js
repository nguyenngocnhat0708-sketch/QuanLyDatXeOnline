const { getPool, sql, db } = require('../config/database');

function mapFirestoreTrip(doc) {
  const data = doc.data ? doc.data() : doc;
  return {
    TripID: data.TripID || data.tripId || (typeof doc.id === 'string' ? doc.id.replace('trip_', '') : 1),
    Origin: data.Origin || data.route?.origin || 'Bình Định',
    Destination: data.Destination || data.route?.destination || 'Quy Nhơn',
    DepartureTime: data.DepartureTime || data.departureTime || new Date(Date.now() + 86400000).toISOString(),
    ArrivalTime: data.ArrivalTime || data.arrivalTime || new Date(Date.now() + 90000000).toISOString(),
    BasePrice: data.BasePrice || data.basePrice || 150000,
    AvailableSeats: data.AvailableSeats !== undefined ? data.AvailableSeats : (data.availableSeats !== undefined ? data.availableSeats : 16),
    PlateNumber: data.PlateNumber || data.bus?.plateNumber || '77B-123.45',
    BusType: data.BusType || data.bus?.busType || 'Limousine VIP',
    TotalSeats: data.TotalSeats || data.bus?.totalSeats || 16,
    DriverName: data.DriverName || data.driver?.driverName || 'Tài xế JESOUL',
    Status: data.Status || data.status || 'Scheduled'
  };
}

class TripModel {
  static async searchAvailableTrips({ origin, destination, seatQuantity = 1, departureDate = null }) {
    // Nếu có kết nối Firebase Firestore
    if (db) {
      try {
        const snapshot = await db.collection('trips').get();
        const list = [];
        if (!snapshot.empty) {
          snapshot.forEach(doc => {
            const t = mapFirestoreTrip(doc);
            let matches = (t.Status === 'Scheduled') && (t.AvailableSeats >= seatQuantity);

            if (origin && !t.Origin.toLowerCase().includes(origin.toLowerCase())) {
              matches = false;
            }
            if (destination && !t.Destination.toLowerCase().includes(destination.toLowerCase())) {
              matches = false;
            }
            if (departureDate && t.DepartureTime) {
              const tripDate = t.DepartureTime.substring(0, 10);
              if (tripDate !== departureDate) {
                matches = false;
              }
            }

            if (matches) list.push(t);
          });
          list.sort((a, b) => new Date(a.DepartureTime) - new Date(b.DepartureTime));
        }
        return list;
      } catch (err) {
        console.error('[TripModel] Lỗi đọc trips từ Firestore:', err.message);
        return [];
      }
    }

    // Fallback sang SQL Server nếu chạy cục bộ
    const pool = getPool();
    const request = pool.request();
    request.input('seatQuantity', sql.Int, seatQuantity);

    let query = `
      SELECT 
        t.TripID,
        r.Origin,
        r.Destination,
        t.DepartureTime,
        t.ArrivalTime,
        t.BasePrice,
        t.AvailableSeats,
        b.PlateNumber,
        b.BusType,
        b.TotalSeats,
        u.FullName AS DriverName,
        t.Status
      FROM dbo.Trips t
      INNER JOIN dbo.Routes r ON t.RouteID = r.RouteID
      INNER JOIN dbo.Buses b ON t.BusID = b.BusID
      INNER JOIN dbo.Users u ON t.DriverID = u.UserID
      WHERE t.Status = 'Scheduled'
        AND t.DepartureTime > DATEADD(MINUTE, 30, SYSUTCDATETIME())
        AND t.AvailableSeats >= @seatQuantity
    `;

    if (origin) {
      query += ` AND r.Origin LIKE @origin`;
      request.input('origin', sql.NVarChar, `%${origin}%`);
    }

    if (destination) {
      query += ` AND r.Destination LIKE @destination`;
      request.input('destination', sql.NVarChar, `%${destination}%`);
    }

    if (departureDate) {
      query += ` AND CAST(t.DepartureTime AS DATE) = @departureDate`;
      request.input('departureDate', sql.Date, departureDate);
    }

    query += ` ORDER BY t.DepartureTime ASC;`;

    const result = await request.query(query);
    return result.recordset;
  }

  // Khóa hàng bi quan (Pessimistic Lock) chống Race Condition
  static async getTripForUpdate(tripId, transaction) {
    if (db) {
      return this.findTripById(tripId);
    }

    const request = new sql.Request(transaction);
    request.input('tripId', sql.Int, tripId);

    const result = await request.query(`
      SELECT TripID, RouteID, BusID, DriverID, DepartureTime, ArrivalTime, BasePrice, AvailableSeats, Status
      FROM dbo.Trips WITH (UPDLOCK, ROWLOCK)
      WHERE TripID = @tripId;
    `);
    return result.recordset[0] || null;
  }

  static async adjustAvailableSeats(tripId, delta, transaction) {
    if (db) {
      try {
        let docRef = db.collection('trips').doc(String(tripId));
        let snap = await docRef.get();
        if (!snap.exists) {
          docRef = db.collection('trips').doc(`trip_${tripId}`);
          snap = await docRef.get();
        }
        if (snap.exists) {
          const cur = snap.data().availableSeats ?? snap.data().AvailableSeats ?? 16;
          await docRef.update({ availableSeats: cur + delta });
        }
      } catch (err) {
        console.error('[TripModel] Lỗi adjustAvailableSeats Firestore:', err.message);
      }
      return;
    }

    const request = new sql.Request(transaction);
    request.input('tripId', sql.Int, tripId);
    request.input('delta', sql.Int, delta);

    await request.query(`
      UPDATE dbo.Trips
      SET AvailableSeats = AvailableSeats + @delta
      WHERE TripID = @tripId;
    `);
  }

  static async findTripByDriver(driverId, transaction = null) {
    if (db) {
      const trips = await this.findTripsList(driverId);
      return trips[0] || null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('driverId', sql.Int, driverId);

    const result = await request.query(`
      SELECT TOP 1
        t.TripID, t.DepartureTime, t.ArrivalTime, t.BasePrice, t.AvailableSeats, t.Status,
        r.Origin, r.Destination,
        b.PlateNumber, b.BusType, b.TotalSeats
      FROM dbo.Trips t
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses b ON t.BusID = b.BusID
      WHERE t.DriverID = @driverId
      ORDER BY t.DepartureTime ASC;
    `);
    return result.recordset[0] || null;
  }

  static async findFirstTrip(transaction = null) {
    if (db) {
      const trips = await this.findTripsList();
      return trips[0] || null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    const result = await request.query(`
      SELECT TOP 1
        t.TripID, t.DepartureTime, t.ArrivalTime, t.BasePrice, t.AvailableSeats, t.Status,
        r.Origin, r.Destination,
        b.PlateNumber, b.BusType, b.TotalSeats
      FROM dbo.Trips t
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses b ON t.BusID = b.BusID
      WHERE t.Status = 'Scheduled'
      ORDER BY t.DepartureTime ASC;
    `);
    return result.recordset[0] || null;
  }

  static async findTripById(tripId, transaction = null) {
    if (db) {
      try {
        const docRef = db.collection('trips').doc(String(tripId));
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          return mapFirestoreTrip(docSnap);
        }
        const docRefPrefixed = db.collection('trips').doc(`trip_${tripId}`);
        const docSnapPrefixed = await docRefPrefixed.get();
        if (docSnapPrefixed.exists) {
          return mapFirestoreTrip(docSnapPrefixed);
        }
        const q = await db.collection('trips').where('tripId', '==', Number(tripId)).get();
        if (!q.empty) {
          return mapFirestoreTrip(q.docs[0]);
        }
      } catch (err) {
        console.error('[TripModel] Lỗi findTripById từ Firestore:', err.message);
      }
      return null;
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('tripId', sql.Int, tripId);
    const result = await request.query(`
      SELECT t.TripID, t.DepartureTime, t.ArrivalTime, t.BasePrice, t.AvailableSeats, t.Status,
             r.Origin, r.Destination,
             b.PlateNumber, b.BusType, b.TotalSeats
      FROM dbo.Trips t
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses b ON t.BusID = b.BusID
      WHERE t.TripID = @tripId;
    `);
    return result.recordset[0] || null;
  }

  static async findTripByIdAndDriver(tripId, driverId, transaction = null) {
    if (db) {
      return this.findTripById(tripId);
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('tripId', sql.Int, tripId);
    request.input('driverId', sql.Int, driverId);

    const result = await request.query(`
      SELECT t.TripID, t.DepartureTime, t.ArrivalTime, t.BasePrice, t.AvailableSeats, t.Status,
             r.Origin, r.Destination,
             b.PlateNumber, b.BusType, b.TotalSeats
      FROM dbo.Trips t
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses b ON t.BusID = b.BusID
      WHERE t.TripID = @tripId AND t.DriverID = @driverId;
    `);
    return result.recordset[0] || null;
  }

  static async findTripsList(driverId = null, isAdmin = false) {
    if (db) {
      try {
        const snapshot = await db.collection('trips').get();
        const list = [];
        if (!snapshot.empty) {
          snapshot.forEach(doc => {
            const t = mapFirestoreTrip(doc);
            t.PassengerCount = doc.data().passengerCount || 0;
            list.push(t);
          });
          list.sort((a, b) => new Date(a.DepartureTime) - new Date(b.DepartureTime));
        }
        return list;
      } catch (err) {
        console.error('[TripModel] Lỗi findTripsList từ Firestore:', err.message);
        return [];
      }
    }

    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT 
        t.TripID, t.DepartureTime, t.ArrivalTime, t.BasePrice, t.AvailableSeats, t.Status,
        r.Origin, r.Destination,
        b.PlateNumber, b.BusType, b.TotalSeats,
        u.FullName AS DriverName,
        (
          SELECT COUNT(*) 
          FROM dbo.Tickets tk 
          JOIN dbo.Bookings bk ON tk.BookingID = bk.BookingID 
          WHERE bk.TripID = t.TripID AND tk.Status != 'Cancelled'
        ) AS PassengerCount
      FROM dbo.Trips t
      JOIN dbo.Routes r ON t.RouteID = r.RouteID
      JOIN dbo.Buses b ON t.BusID = b.BusID
      JOIN dbo.Users u ON t.DriverID = u.UserID
      WHERE t.Status = 'Scheduled'
    `;

    if (!isAdmin && driverId) {
      query += ` AND t.DriverID = @driverId`;
      request.input('driverId', sql.Int, driverId);
    }

    query += ` ORDER BY t.DepartureTime ASC;`;

    const result = await request.query(query);
    return result.recordset;
  }
}

module.exports = TripModel;
