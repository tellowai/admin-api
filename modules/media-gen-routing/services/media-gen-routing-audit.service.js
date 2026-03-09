'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

async function log(ruleId, action, adminId, before = null, after = null) {
  const diff = { before, after };
  const query = `
    INSERT INTO media_gen_routing_audit_log (rule_id, action, admin_id, diff_json)
    VALUES (?, ?, ?, ?)
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [
    ruleId,
    action,
    adminId || null,
    JSON.stringify(diff)
  ]);
}

module.exports = { log };
