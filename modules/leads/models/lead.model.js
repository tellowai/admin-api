'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.getLead = async function(leadId) {
  const query = `
    SELECT 
      id,
      mobile,
      user_agent,
      created_at,
      updated_at
    FROM user_leads
    WHERE id = ?
    AND archived_at IS NULL
  `;
  
  const [lead] = await mysqlQueryRunner.runQueryInSlave(query, [leadId]);
  return lead;
};

exports.listLeads = async function(limit = 10, offset = 0) {
  const query = `
    SELECT 
      id,
      mobile,
      user_agent,
      created_at,
      updated_at
    FROM user_leads
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  
  return await mysqlQueryRunner.runQueryInSlave(query, [limit, offset]);
};

exports.countLeads = async function() {
  const query = `
    SELECT COUNT(*) as count
    FROM user_leads
    WHERE archived_at IS NULL
  `;
  
  const [result] = await mysqlQueryRunner.runQueryInSlave(query, []);
  return result.count;
};
