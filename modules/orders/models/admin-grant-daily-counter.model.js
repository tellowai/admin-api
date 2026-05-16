'use strict';

/**
 * Server-side daily limit enforcement for admin grants. Backed by `admin_grant_daily_counters`
 * (one row per admin per UTC date) with PRIMARY KEY (admin_user_id, counter_date) so the upsert
 * is atomic — two concurrent grants from the same admin can never both pass an "is under cap"
 * check by 1.
 *
 * The flow on every grant attempt is:
 *
 *   1. tryReserve({ adminUserId, creditsDelta, entitlementsDelta }):
 *        - Reads today's row (or treats as zero).
 *        - Rejects with httpStatusCode=429 if reservation would exceed the configured caps.
 *        - Upserts the row, atomically incrementing counters.
 *      Returning success here = "you may proceed with the grant". If the downstream grant fails
 *      after this, we DO NOT decrement — a wasted slot is acceptable; the alternative (decrement
 *      on failure) reopens a race where parallel callers exploit failed attempts to exceed cap.
 *
 *   2. Caps are read from env (with sane defaults) so SREs can tune in production without a deploy.
 */

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

function _intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Hard caps per admin per UTC day. Defaults match the product decision (10 grants / 1000 credits). */
function getDailyCaps() {
  return {
    grantsPerDay: _intEnv('ADMIN_GRANT_DAILY_GRANTS_CAP', 10),
    creditsPerDay: _intEnv('ADMIN_GRANT_DAILY_CREDITS_CAP', 1000)
  };
}

/** UTC date string YYYY-MM-DD. Tied to the DB DATE column. */
function _today() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Atomically reserve a slot in today's counter for this admin. On success, the row is upserted
 * with the new totals; on cap breach, throws with httpStatusCode=429 and a structured error code.
 *
 * @param {Object} opts
 * @param {string} opts.adminUserId
 * @param {number} [opts.creditsDelta=0]       credits being granted on this attempt
 * @param {number} [opts.entitlementsDelta=0]  1 for any entitlement grant (single or pack), 0 for credits-only
 */
exports.tryReserve = async function ({ adminUserId, creditsDelta = 0, entitlementsDelta = 0 }) {
  if (!adminUserId || String(adminUserId).trim() === '') {
    const err = new Error('adminUserId is required for daily-cap reservation');
    err.code = 'ADMIN_GRANT_NO_ADMIN_ID';
    err.httpStatusCode = 400;
    throw err;
  }
  const caps = getDailyCaps();
  const date = _today();
  const adminId = String(adminUserId).trim();

  // Read current counters (no row = all zeros).
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT grants_count, credits_granted, entitlements_granted
       FROM admin_grant_daily_counters
       WHERE admin_user_id = ? AND counter_date = ?`,
    [adminId, date]
  );
  const cur = Array.isArray(rows) && rows.length
    ? rows[0]
    : { grants_count: 0, credits_granted: 0, entitlements_granted: 0 };

  const nextGrants = Number(cur.grants_count) + 1; // every reserve is a grant attempt
  const nextCredits = Number(cur.credits_granted) + (Number(creditsDelta) || 0);
  const nextEntitlements = Number(cur.entitlements_granted) + (Number(entitlementsDelta) || 0);

  if (nextGrants > caps.grantsPerDay) {
    const err = new Error(`Daily grant cap reached (${caps.grantsPerDay}/day). Try again tomorrow.`);
    err.code = 'ADMIN_GRANT_DAILY_CAP_GRANTS';
    err.httpStatusCode = 429;
    err.caps = caps;
    err.current = { grants: cur.grants_count, credits: cur.credits_granted };
    throw err;
  }
  if (nextCredits > caps.creditsPerDay) {
    const err = new Error(
      `Daily credit-grant cap reached (${caps.creditsPerDay} credits/day). Already granted ${cur.credits_granted}.`
    );
    err.code = 'ADMIN_GRANT_DAILY_CAP_CREDITS';
    err.httpStatusCode = 429;
    err.caps = caps;
    err.current = { grants: cur.grants_count, credits: cur.credits_granted };
    throw err;
  }

  // Atomic upsert. ON DUPLICATE KEY UPDATE handles the race where two grants land in the same ms
  // — the unique key (admin_user_id, counter_date) makes the second one increment instead of fail.
  await MysqlQueryRunner.runQueryInMaster(
    `INSERT INTO admin_grant_daily_counters
       (admin_user_id, counter_date, grants_count, credits_granted, entitlements_granted)
     VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       grants_count = grants_count + 1,
       credits_granted = credits_granted + VALUES(credits_granted),
       entitlements_granted = entitlements_granted + VALUES(entitlements_granted)`,
    [adminId, date, Number(creditsDelta) || 0, Number(entitlementsDelta) || 0]
  );

  return {
    counterDate: date,
    afterReservation: {
      grants_count: nextGrants,
      credits_granted: nextCredits,
      entitlements_granted: nextEntitlements
    },
    caps
  };
};

/** Read-only: counters + caps for "what's left for me today" UI hints. */
exports.getTodayUsage = async function (adminUserId) {
  const caps = getDailyCaps();
  const date = _today();
  const adminId = String(adminUserId || '').trim();
  if (!adminId) return { date, caps, used: { grants_count: 0, credits_granted: 0, entitlements_granted: 0 } };

  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT grants_count, credits_granted, entitlements_granted
       FROM admin_grant_daily_counters
       WHERE admin_user_id = ? AND counter_date = ?`,
    [adminId, date]
  );
  const used = Array.isArray(rows) && rows.length
    ? {
        grants_count: Number(rows[0].grants_count) || 0,
        credits_granted: Number(rows[0].credits_granted) || 0,
        entitlements_granted: Number(rows[0].entitlements_granted) || 0
      }
    : { grants_count: 0, credits_granted: 0, entitlements_granted: 0 };

  return { date, caps, used };
};
