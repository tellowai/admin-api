'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const crypto = require('crypto');

// Basic Models
exports.listTickets = async function(page, limit, status, assignedTo, search) {
  let query = `SELECT * FROM support_tickets WHERE 1=1`;
  const params = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  if (assignedTo) {
    query += ` AND assigned_to = ?`;
    params.push(assignedTo);
  }
  if (search) {
    query += ` AND (ticket_id LIKE ? OR template_id LIKE ? OR generation_id LIKE ?)`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }

  query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  const offset = (page - 1) * limit;
  params.push(limit, offset);

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.countTickets = async function(status, assignedTo, search) {
  let query = `SELECT COUNT(*) as total FROM support_tickets WHERE 1=1`;
  const params = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  if (assignedTo) {
    query += ` AND assigned_to = ?`;
    params.push(assignedTo);
  }
  if (search) {
    query += ` AND (ticket_id LIKE ? OR template_id LIKE ? OR generation_id LIKE ?)`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }

  const result = await mysqlQueryRunner.runQueryInSlave(query, params);
  return result[0].total;
};

exports.getTicketById = async function(ticketId) {
  const query = `SELECT * FROM support_tickets WHERE ticket_id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [ticketId]);
  return result[0] || null;
};

exports.updateTicket = async function(ticketId, updateData) {
  const keys = Object.keys(updateData);
  if (keys.length === 0) return;
  const setString = keys.map(k => `${k} = ?`).join(', ');
  const params = keys.map(k => updateData[k]);
  params.push(ticketId);

  const query = `UPDATE support_tickets SET ${setString} WHERE ticket_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, params);
};

exports.getUsersByIds = async function(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const query = `SELECT user_id, email, first_name, last_name, profile_pic, display_name FROM user WHERE user_id IN (${placeholders})`;
  return await mysqlQueryRunner.runQueryInSlave(query, userIds);
};

exports.getTicketMessages = async function(ticketId) {
  const query = `SELECT * FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ticketId]);
};

exports.getTicketMessageById = async function(messageId) {
  const query = `SELECT * FROM support_ticket_messages WHERE message_id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [messageId]);
  return result[0] || null;
};

exports.insertTicketMessage = async function(ticketId, senderType, senderId, message) {
  const messageId = crypto.randomUUID();
  const query = `
    INSERT INTO support_ticket_messages (message_id, ticket_id, sender_type, sender_id, message)
    VALUES (?, ?, ?, ?, ?)
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [messageId, ticketId, senderType, senderId, message]);

  // Bump the ticket's updated_at timestamp so it floats to the top of queues
  const updateQuery = `UPDATE support_tickets SET updated_at = NOW() WHERE ticket_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(updateQuery, [ticketId]);

  return messageId;
};

// --- Generation Metadata Fetchers ---
exports.getGenerationFromMySQL = async function(generationId) {
  const query = `
    SELECT 
      media_generation_id, job_status,
      output_media_asset_key, output_media_bucket, output_metadata, media_type,
      estimated_cost, cost_unit, error_message
    FROM media_generations 
    WHERE media_generation_id = ?
  `;
  try {
    const res = await mysqlQueryRunner.runQueryInSlave(query, [generationId]);
    return res[0] || null;
  } catch(err) {
    console.error('getGenerationFromMySQL error:', err);
    return null;
  }
};

exports.deleteMessage = async function(messageId) {
  const query = `DELETE FROM support_ticket_messages WHERE message_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, [messageId]);
};

const clickHouseQueryRunner = require('../../core/models/clickhouse.promise.model');
exports.getGenerationEventsFromClickHouse = async function(generationId) {
  const query = `
    SELECT 
      event_type, additional_data, created_at
    FROM resource_generation_events
    WHERE resource_generation_id = '${generationId}'
    ORDER BY created_at DESC
  `;
  try {
    const res = await clickHouseQueryRunner.runQueryingInSlave(query);
    return res || [];
  } catch(err) {
    console.error('ClickHouse Support Query Error:', err);
    return [];
  }
};

exports.getResourceGenerationFromClickHouse = async function(generationId) {
  const query = `
    SELECT 
      resource_generation_id,
      user_id,
      template_id,
      media_type,
      created_at
    FROM resource_generations
    WHERE resource_generation_id = '${generationId}'
  `;
  try {
    const res = await clickHouseQueryRunner.runQueryingInSlave(query, { dataObjects: true });
    return Array.isArray(res) ? (res[0] || null) : (res.data?.[0] || null);
  } catch(err) {
    console.error('ClickHouse Resource Generation Query Error:', err);
    return null;
  }
};


exports.getDeductedCreditsForGeneration = async function(generationId) {
  const query = `
    SELECT SUM(amount) as total_deducted
    FROM credits_transactions
    WHERE reference_id = ? AND transaction_type = 'deduction' AND status = 'completed'
  `;
  try {
    const res = await mysqlQueryRunner.runQueryInSlave(query, [generationId]);
    return res[0]?.total_deducted || 0;
  } catch(err) {
    console.error('getDeductedCreditsForGeneration error:', err);
    return 0;
  }
};

exports.getRefundedCreditsForGeneration = async function(generationId) {
  const query = `
    SELECT SUM(amount) as total_refunded
    FROM credits_transactions
    WHERE reference_id = ? AND transaction_type = 'refund' AND status = 'completed'
  `;
  try {
    const res = await mysqlQueryRunner.runQueryInSlave(query, [generationId]);
    return res[0]?.total_refunded || 0;
  } catch(err) {
    console.error('getRefundedCreditsForGeneration error:', err);
    return 0;
  }
};

exports.countOtherTicketsForGeneration = async function(generationId, ticketId) {
  const query = `
    SELECT COUNT(*) as total
    FROM support_tickets
    WHERE generation_id = ? AND ticket_id != ?
  `;
  try {
    const res = await mysqlQueryRunner.runQueryInSlave(query, [generationId, ticketId]);
    return res[0]?.total || 0;
  } catch(err) {
    console.error('countOtherTicketsForGeneration error:', err);
    return 0;
  }
};
