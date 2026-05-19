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

async function getUserCreditsTransactions(userId, page, limit, options = {}) {
  const useMaster = options.useMaster === true;
  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
  const offset = (page - 1) * limit;

  const transactionsQuery = `
    SELECT * FROM credits_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const balanceQuery = `
    SELECT balance, reserved_balance FROM user_credits WHERE user_id = ?
  `;

  const [transactions, balanceResult] = await Promise.all([
    runQuery(transactionsQuery, [userId, limit, offset]),
    runQuery(balanceQuery, [userId])
  ]);

  const balance = balanceResult[0] ? Number(balanceResult[0].balance) || 0 : 0;
  const reserved_balance = balanceResult[0] ? Number(balanceResult[0].reserved_balance) || 0 : 0;

  return {
    transactions,
    balance,
    reserved_balance
  };
}

/** Wallet balances for many users (admin tables). Keys are string user_id. */
async function getBalancesByUserIds(userIds, options = {}) {
  const useMaster = options.useMaster === true;
  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
  const ids = [...new Set((userIds || []).filter((id) => id != null && String(id).trim() !== '').map((id) => String(id)))];
  const map = new Map();
  if (!ids.length) return map;

  const rows = await runQuery(
    'SELECT user_id, balance, reserved_balance FROM user_credits WHERE user_id IN (?)',
    [ids]
  );

  for (const r of rows || []) {
    const uid = String(r.user_id);
    map.set(uid, {
      balance: Number(r.balance) || 0,
      reserved_balance: Number(r.reserved_balance) || 0
    });
  }
  return map;
}

module.exports = {
  refundCreditsTransaction,
  getUserCreditsTransactions,
  getBalancesByUserIds
};
