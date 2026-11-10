const { getPool, sql, db } = require('../config/database');

class PaymentModel {
  static async recordTransaction({ bookingId, paymentMethod = 'BankTransfer', transactionRef, amount, status = 'Success', bankName = 'MB Bank', bankAccountNo = '0987654321' }, transaction = null) {
    if (db) {
      const payDoc = {
        transactionId: 'tx_' + Date.now(),
        bookingId,
        paymentMethod,
        transactionRef,
        amount,
        status,
        bankName,
        bankAccountNo,
        paidAt: new Date().toISOString()
      };
      await db.collection('payments').doc(payDoc.transactionId).set(payDoc);
      return {
        TransactionID: payDoc.transactionId,
        TransactionRef: transactionRef,
        Status: status,
        PaidAt: payDoc.paidAt
      };
    }

    const request = transaction ? new sql.Request(transaction) : getPool().request();
    request.input('bookingId', sql.Int, bookingId);
    request.input('paymentMethod', sql.VarChar, paymentMethod);
    request.input('transactionRef', sql.VarChar, transactionRef);
    request.input('amount', sql.Decimal(18, 2), amount);
    request.input('status', sql.VarChar, status);
    request.input('bankName', sql.NVarChar, bankName);
    request.input('bankAccountNo', sql.VarChar, bankAccountNo);

    const result = await request.query(`
      INSERT INTO dbo.PaymentTransactions (BookingID, PaymentMethod, TransactionRef, Amount, Status, BankName, BankAccountNo, PaidAt)
      OUTPUT INSERTED.TransactionID, INSERTED.TransactionRef, INSERTED.Status, INSERTED.PaidAt
      VALUES (@bookingId, @paymentMethod, @transactionRef, @amount, @status, @bankName, @bankAccountNo, SYSUTCDATETIME());
    `);
    return result.recordset[0];
  }
}

module.exports = PaymentModel;

