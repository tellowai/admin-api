'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { createId } = require('@paralleldrive/cuid2');

/**
 * Credits model for admin-api (support refunds only).
 * Uses same DB tables as main API (user_credits, credits_transactions).
 */
async function createTransaction(connection, userId, transactionType, amount, referenceType, referenceId, description, status = 'completed') {
  const transactionId = createId();
  const insertQuery = `
    INSERT INTO credits_transactions (
      user_id,
      transaction_type,
      amount,
      status,
      reference_type,
      reference_id,
      description,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

  await connection.query(insertQuery, [
    userId,
    transactionType,
    amount,
    status,
    referenceType,
    referenceId,
    description
  ]);

  return transactionId;
}

async function refundCreditsTransaction(userId, amount, referenceType, referenceId, description) {
  const connection = await MysqlQueryRunner.getConnectionFromMaster();
  try {
    await connection.beginTransaction();

    const upsertQuery = `
      INSERT INTO user_credits (user_id, balance, reserved_balance, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE 
        balance = balance + ?,
        updated_at = CURRENT_TIMESTAMP
    `;

    await connection.query(upsertQuery, [userId, amount, amount]);

    const transactionId = await createTransaction(
      connection,
      userId,
      'refund',
      amount,
      referenceType,
      referenceId,
      description
    );

    await connection.commit();
    return { success: true, transactionId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  refundCreditsTransaction
};
