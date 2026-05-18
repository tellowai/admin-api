'use strict';

/**
 * Read-side model for `payment_orphan_events` — the unified reconciliation queue that photobop-api writes to
 * for both Google Play and Apple IAP purchases that could not be linked to an internal `orders` row.
 *
 * This is read-only here on the admin side; writes happen in photobop-api (modules/payment/models/payment-orphan.model.js).
 */

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

const SUPPORTED_GATEWAYS = Object.freeze(['google_play', 'apple_iap']);

function _normaliseGateway(gateway) {
  const g = gateway != null ? String(gateway).trim().toLowerCase() : '';
  return SUPPORTED_GATEWAYS.includes(g) ? g : null;
}

const ORPHAN_SELECT_COLUMNS = `
  id,
  gateway,
  purchase_token,
  play_order_id,
  product_id,
  source,
  reason_code,
  user_id_hint,
  requested_internal_order_id,
  notification_type,
  payload_json,
  apple_app_account_token,
  signed_transaction_info,
  app_version,
  device_os,
  device_os_version,
  device_brand,
  device_model,
  first_seen_at,
  last_seen_at
`;

exports.countOrphansAdmin = async function ({ gateway } = {}) {
  const g = _normaliseGateway(gateway);
  const params = [];
  let where = '';
  if (g) {
    where = 'WHERE gateway = ?';
    params.push(g);
  }
  const query = `SELECT COUNT(*) AS total FROM payment_orphan_events ${where}`;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  const r = rows && rows[0];
  const n = r && r.total != null ? Number(r.total) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Newest reconciliation candidates first. `gateway` is optional (omit to list across all gateways).
 *
 * @param {{ limit: number, offset: number, gateway?: 'google_play'|'apple_iap' }} args
 */
exports.listOrphansAdmin = async function ({ limit, offset, gateway } = {}) {
  const g = _normaliseGateway(gateway);
  const params = [];
  let where = '';
  if (g) {
    where = 'WHERE gateway = ?';
    params.push(g);
  }
  params.push(limit, offset);
  const query = `
    SELECT ${ORPHAN_SELECT_COLUMNS}
    FROM payment_orphan_events
    ${where}
    ORDER BY last_seen_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, params);
};

exports.SUPPORTED_GATEWAYS = SUPPORTED_GATEWAYS;
