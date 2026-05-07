'use strict';

/**
 * Queue of Google Play purchases we could not match to an internal order at webhook/verify time (photobop-api writes).
 */
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.countOrphansAdmin = async function () {
  const query = `SELECT COUNT(*) AS total FROM google_play_orphan_events`;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, []);
  const r = rows && rows[0];
  const n = r && r.total != null ? Number(r.total) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Newest reconciliation candidates first.
 */
exports.listOrphansAdmin = async function ({ limit, offset }) {
  const query = `
    SELECT
      id,
      purchase_token,
      play_order_id,
      product_id,
      source,
      reason_code,
      user_id_hint,
      requested_internal_order_id,
      notification_type,
      payload_json,
      app_version,
      device_os,
      device_os_version,
      device_brand,
      device_model,
      first_seen_at,
      last_seen_at
    FROM google_play_orphan_events
    ORDER BY last_seen_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [limit, offset]);
};
