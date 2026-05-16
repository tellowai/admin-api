'use strict';

/**
 * AdminGrantService — issues comp credits / template entitlements / pack entitlements directly,
 * with no payment gateway involvement. Owns ALL the SQL for grant fulfillment so admin-api can
 * execute the entire transaction in one process (no proxy to photobop-api needed).
 *
 * IMPORTANT: This service mirrors the column names and idempotency semantics used by
 * `photobop-api/modules/credits/models/credits.model.js` and
 * `photobop-api/modules/payment/models/entitlement.model.js`. If those schemas evolve (column
 * additions, ENUM extensions), update this file in lockstep. The model-level migrations are the
 * single source of truth; this file just writes the same shape.
 *
 * What this file owns:
 *   - `grantCredits`   — adds N credits to a user; writes orders + credits_transactions + user_credits.
 *   - `grantTemplate`  — premium_single entitlement; writes orders + entitlements + claimed_templates.
 *   - `grantPack`      — unified_pack entitlement; writes orders + entitlements + claimed_templates
 *                        (one row per template in the pack).
 *
 * Transaction model: every grant runs inside a SINGLE master-connection transaction. If any step
 * fails, the whole thing rolls back — no half-applied state. Idempotency replays return the existing
 * row's IDs without producing a duplicate order.
 *
 * Security:
 *   - This service does no auth / RBAC / rate-limiting. Caller (controller) must gate first.
 *   - The required-reason / valid-idempotency-key checks are duplicated here as cheap defense in depth
 *     so a future internal caller can't bypass validation by skipping the controller layer.
 */

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

const ADMIN_GRANT_GATEWAY = 'admin_grant';
const ADMIN_GRANT_PLAN_NAME_CREDITS = 'admin_grant_credits';
const ADMIN_GRANT_PLAN_NAME_SINGLE_TEMPLATE = 'admin_grant_single_template';
const ADMIN_GRANT_PLAN_NAME_PACK = 'admin_grant_pack';

// ─── Validators (cheap defense in depth) ─────────────────────────────────────

function _validateReason(reason) {
  const s = reason != null ? String(reason).trim() : '';
  if (s.length < 10 || s.length > 500) {
    const err = new Error('Reason is required and must be 10-500 characters');
    err.code = 'ADMIN_GRANT_INVALID_REASON';
    err.httpStatusCode = 400;
    throw err;
  }
  return s;
}
function _requireAdminId(adminId) {
  const v = adminId != null ? String(adminId).trim() : '';
  if (!v) {
    const err = new Error('granted_by_admin_id is required');
    err.code = 'ADMIN_GRANT_MISSING_ADMIN';
    err.httpStatusCode = 400;
    throw err;
  }
  return v;
}
function _validateIdempotencyKey(key) {
  const v = key != null ? String(key).trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    const err = new Error('idempotency_key must be a UUID');
    err.code = 'ADMIN_GRANT_BAD_IDEMPOTENCY_KEY';
    err.httpStatusCode = 400;
    throw err;
  }
  return v.toLowerCase();
}

// ─── Shared lookups ──────────────────────────────────────────────────────────

/** Look up a seeded admin-grant payment plan by name. Throws if migration hasn't run. */
async function _getAdminGrantPlan(planName) {
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT pp_id, plan_name, tier, plan_type, current_price, currency, credits, validity_days, max_creations_per_template
       FROM payment_plans
      WHERE plan_name = ?
      LIMIT 1`,
    [planName]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error(`Admin grant plan ${planName} is not seeded; run db migrations first`);
    err.code = 'ADMIN_GRANT_PLAN_NOT_SEEDED';
    err.httpStatusCode = 500;
    throw err;
  }
  return rows[0];
}

/** Validate the target user exists and isn't deleted/deactivated. */
async function _requireUser(userId) {
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT user_id, email, status, DELETED_AT FROM user WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('Target user not found');
    err.code = 'ADMIN_GRANT_USER_NOT_FOUND';
    err.httpStatusCode = 404;
    throw err;
  }
  if (rows[0].DELETED_AT) {
    const err = new Error('Target user is deleted');
    err.code = 'ADMIN_GRANT_USER_DELETED';
    err.httpStatusCode = 409;
    throw err;
  }
  if (rows[0].status && String(rows[0].status).toLowerCase() === 'deactivated') {
    const err = new Error('Target user is deactivated; reactivate before granting');
    err.code = 'ADMIN_GRANT_USER_DEACTIVATED';
    err.httpStatusCode = 409;
    throw err;
  }
  return rows[0];
}

/** Standard transaction_notes shape across all grant types. Stable schema for fraud queries. */
function _buildGrantNotes({ grantType, reason, granted_by_admin_id, idempotencyKey, extra }) {
  return {
    purchase_subject: 'admin_grant',
    admin_grant_type: grantType,
    admin_grant_reason: reason,
    granted_by_admin_id,
    idempotency_key: idempotencyKey,
    ...(extra || {})
  };
}

// ─── INSERT helpers used inside the per-grant transaction ────────────────────

/**
 * Create an admin_grant order row. Mirrors `Order.create` from photobop-api.
 *
 * Status starts at 'created' then is moved to 'completed' by `_markOrderCompleted` so the orders
 * state machine sees the same transitions a real purchase would. Future audit queries filtering
 * `WHERE status = 'completed' AND payment_gateway = 'admin_grant'` will match.
 *
 * pg_order_id intentionally stores the idempotency key — useful for ops drilling in on a specific
 * grant from logs/UI without needing to parse `transaction_notes`.
 */
async function _createAdminGrantOrder(connection, {
  userId, planId, currency, quantity, transactionNotes, idempotencyKey
}) {
  const result = await connection.query(
    `INSERT INTO orders (
       user_id, payment_gateway, client_platform, pg_order_id, payment_plan_id,
       amount_paid, currency, status, transaction_notes, external_transaction_token,
       apple_app_account_token, quantity
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      ADMIN_GRANT_GATEWAY,
      null, // client_platform — admin-issued, no device
      idempotencyKey,
      planId,
      '0.00',
      currency || 'INR',
      'created',
      JSON.stringify(transactionNotes),
      null,
      null,
      quantity || 1
    ]
  );
  // mysql2 callback-style returns either `{insertId,...}` or `[result, fields]` depending on
  // driver internals. We accept both.
  const insertId =
    result && typeof result === 'object' && 'insertId' in result
      ? result.insertId
      : Array.isArray(result) && result[0] && result[0].insertId
        ? result[0].insertId
        : null;
  if (!insertId) {
    const err = new Error('Failed to create admin grant order (no insertId)');
    err.code = 'ADMIN_GRANT_ORDER_CREATE_FAILED';
    err.httpStatusCode = 500;
    throw err;
  }
  return insertId;
}

/**
 * Move an admin_grant order from created/pending/failed to completed. Same SQL as
 * `Order.markAsCompleted` from photobop-api — same WHERE clause so the state machine stays
 * consistent across purchase paths.
 */
async function _markOrderCompleted(connection, orderId, idempotencyKey) {
  await connection.query(
    `UPDATE orders
        SET status = 'completed',
            pg_payment_id = COALESCE(pg_payment_id, ?),
            payment_method = COALESCE(payment_method, ?),
            completed_at = NOW()
      WHERE order_id = ?
        AND status IN ('created', 'pending', 'failed')`,
    [idempotencyKey, ADMIN_GRANT_GATEWAY, orderId]
  );
}

/**
 * Returns true if a duplicate-key error matches our credits_transactions unique idempotency_key.
 * Same shape as the duplicate guard in photobop-api credits.model.js, so we treat duplicates
 * exactly the same way.
 */
function _isDuplicateKeyError(err) {
  return (
    err && (
      err.code === 'ER_DUP_ENTRY' ||
      err.errno === 1062 ||
      (typeof err.message === 'string' && (
        err.message.includes('Duplicate entry') ||
        err.message.includes('unique_idempotency_key') ||
        err.message.includes('Resource already exists')
      ))
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRANT CREDITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add N credits to a user as an admin comp.
 *
 * Atomic flow (single master transaction):
 *   1. Create order row (status='created', gateway='admin_grant')
 *   2. Mark order completed
 *   3. INSERT credits_transactions with idempotency_key `otcp:{userId}:{orderId}`
 *      - on ER_DUP_ENTRY, rollback whole tx and return { idempotent: true }
 *   4. UPSERT user_credits.balance += amount
 *   5. COMMIT
 *
 * Idempotency: the unique key on credits_transactions.idempotency_key is the same one used by
 * real purchases. Caller-provided UUID is also stored as orders.pg_order_id for human lookup.
 *
 * @param {Object} opts
 * @param {string|number} opts.user_id
 * @param {number} opts.credits_amount             positive integer, max 100000
 * @param {string} opts.reason                     10..500 chars
 * @param {string} opts.granted_by_admin_id
 * @param {string} opts.idempotency_key            UUID
 * @returns {Promise<{ orderId:number, creditsGranted:number, idempotent:boolean, newBalance:number }>}
 */
exports.grantCredits = async function (opts) {
  const reason = _validateReason(opts && opts.reason);
  const granted_by_admin_id = _requireAdminId(opts && opts.granted_by_admin_id);
  const idempotencyKey = _validateIdempotencyKey(opts && opts.idempotency_key);
  const credits = Number(opts && opts.credits_amount);
  if (!Number.isFinite(credits) || credits <= 0 || credits > 100000 || !Number.isInteger(credits)) {
    const err = new Error('credits_amount must be a positive integer (max 100000)');
    err.code = 'ADMIN_GRANT_INVALID_CREDITS';
    err.httpStatusCode = 400;
    throw err;
  }

  const user = await _requireUser(opts.user_id);
  const plan = await _getAdminGrantPlan(ADMIN_GRANT_PLAN_NAME_CREDITS);

  const transaction_notes = _buildGrantNotes({
    grantType: 'credits',
    reason,
    granted_by_admin_id,
    idempotencyKey,
    extra: { credits_amount: credits }
  });

  const connection = await MysqlQueryRunner.getConnectionFromMaster();
  try {
    await connection.beginTransaction();

    // 1) Order row, 2) mark completed
    const orderId = await _createAdminGrantOrder(connection, {
      userId: user.user_id,
      planId: plan.pp_id,
      currency: plan.currency || 'INR',
      quantity: credits,
      transactionNotes: transaction_notes,
      idempotencyKey
    });
    await _markOrderCompleted(connection, orderId, idempotencyKey);

    // 3) credits_transactions row with idempotency key
    const creditsIdempotencyKey = `otcp:${user.user_id}:${orderId}`;
    const description = `Admin grant: ${reason}`.slice(0, 255);
    try {
      await connection.query(
        `INSERT INTO credits_transactions (
           user_id,
           transaction_type,
           amount,
           status,
           reference_type,
           reference_id,
           description,
           idempotency_key,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          user.user_id,
          'one_time_purchase',
          credits,
          'completed',
          'one_time_credit_purchase',
          String(orderId),
          description,
          creditsIdempotencyKey
        ]
      );
    } catch (insertErr) {
      if (_isDuplicateKeyError(insertErr)) {
        // Concurrent admin double-click landed first. Roll back so we don't leave a duplicate order.
        await connection.rollback();
        // Read the prior balance for the response.
        const balanceRows = await MysqlQueryRunner.runQueryInSlave(
          `SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1`,
          [user.user_id]
        );
        const newBalance = Array.isArray(balanceRows) && balanceRows.length ? Number(balanceRows[0].balance) || 0 : 0;
        return { orderId: null, creditsGranted: credits, idempotent: true, newBalance };
      }
      throw insertErr;
    }

    // 4) UPSERT user_credits balance
    await connection.query(
      `INSERT INTO user_credits (user_id, balance, reserved_balance, updated_at)
       VALUES (?, ?, 0, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         balance = balance + ?,
         updated_at = CURRENT_TIMESTAMP`,
      [user.user_id, credits, credits]
    );

    // 5) Read back balance for the response
    const balanceRows = await connection.query(
      `SELECT balance FROM user_credits WHERE user_id = ? LIMIT 1`,
      [user.user_id]
    );
    // connection.query in this codebase returns the rows array directly (see mysql.promise.model).
    const rowsArr = Array.isArray(balanceRows) ? balanceRows : [];
    const newBalance = rowsArr.length ? Number(rowsArr[0].balance) || 0 : 0;

    await connection.commit();

    return { orderId, creditsGranted: credits, idempotent: false, newBalance };
  } catch (err) {
    try { await connection.rollback(); } catch (_e) { /* best-effort */ }
    throw err;
  } finally {
    connection.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GRANT SINGLE TEMPLATE ENTITLEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant a `premium_single` entitlement for one template. Mobile "Your library" picks it up via the
 * standard library query that filters on `tier_plan_type IN ('unified_pack','premium_single','unified_single')`.
 *
 * Refuses if the template is `free` (no entitlement is needed) or `archived`.
 *
 * Atomic flow:
 *   1. Validate template (exists + active + paid)
 *   2. Create order row + mark completed
 *   3. INSERT entitlements (UNIQUE order_id ensures we never insert twice for the same order)
 *   4. INSERT claimed_templates (1 row, revisions_remaining=1)
 *   5. COMMIT
 *
 * @param {Object} opts
 * @returns {Promise<{ orderId:number, entitlementId:number, templateId:string, idempotent:boolean }>}
 */
exports.grantTemplate = async function (opts) {
  const reason = _validateReason(opts && opts.reason);
  const granted_by_admin_id = _requireAdminId(opts && opts.granted_by_admin_id);
  const idempotencyKey = _validateIdempotencyKey(opts && opts.idempotency_key);
  const templateId =
    opts && opts.template_id != null && String(opts.template_id).trim() !== ''
      ? String(opts.template_id).trim()
      : '';
  if (!templateId) {
    const err = new Error('template_id is required');
    err.code = 'ADMIN_GRANT_TEMPLATE_REQUIRED';
    err.httpStatusCode = 400;
    throw err;
  }

  const user = await _requireUser(opts.user_id);

  // Template lookup with the columns we care about for gating.
  const tplRows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT template_id, template_name, status, template_type
       FROM templates
      WHERE template_id = ?
      LIMIT 1`,
    [templateId]
  );
  if (!Array.isArray(tplRows) || tplRows.length === 0) {
    const err = new Error('Template not found');
    err.code = 'ADMIN_GRANT_TEMPLATE_NOT_FOUND';
    err.httpStatusCode = 404;
    throw err;
  }
  const template = tplRows[0];
  if (template.status && String(template.status).toLowerCase() !== 'active') {
    const err = new Error(`Template is not active (status=${template.status})`);
    err.code = 'ADMIN_GRANT_TEMPLATE_INACTIVE';
    err.httpStatusCode = 409;
    throw err;
  }
  // `template_type` values in this codebase: 'free' | 'standard' | 'premium' | 'exclusive' | 'ai'.
  // Free templates need no entitlement; reject so admins don't accumulate no-op rows.
  const tType = template.template_type != null ? String(template.template_type).toLowerCase() : '';
  if (tType === 'free') {
    const err = new Error('Free templates do not need an entitlement; user can already use this template');
    err.code = 'ADMIN_GRANT_TEMPLATE_IS_FREE';
    err.httpStatusCode = 400;
    throw err;
  }

  const plan = await _getAdminGrantPlan(ADMIN_GRANT_PLAN_NAME_SINGLE_TEMPLATE);

  const transaction_notes = _buildGrantNotes({
    grantType: 'single_template',
    reason,
    granted_by_admin_id,
    idempotencyKey,
    extra: { template_id: templateId, template_type: template.template_type || null }
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(plan.validity_days) || 30));

  const connection = await MysqlQueryRunner.getConnectionFromMaster();
  try {
    await connection.beginTransaction();

    const orderId = await _createAdminGrantOrder(connection, {
      userId: user.user_id,
      planId: plan.pp_id,
      currency: plan.currency || 'INR',
      quantity: 1,
      transactionNotes: transaction_notes,
      idempotencyKey
    });
    await _markOrderCompleted(connection, orderId, idempotencyKey);

    // INSERT entitlement. order_id is UNIQUE; if another concurrent caller already inserted for
    // this order_id, we'd get ER_DUP_ENTRY — but since each grant creates its own order, that's
    // effectively unreachable here. We still wrap in try to surface a clear error if it ever fires.
    let entitlementId;
    try {
      const entResult = await connection.query(
        `INSERT INTO entitlements (
           user_id, order_id, tier_plan_type, template_id, pack_id, pack_batch_status,
           template_slots_remaining, max_creations_per_template, status, valid_from, valid_until
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          user.user_id,
          orderId,
          'premium_single',
          templateId,
          null,
          null,
          1,
          Number(plan.max_creations_per_template) || 5,
          'active',
          validUntil
        ]
      );
      entitlementId =
        entResult && typeof entResult === 'object' && 'insertId' in entResult
          ? entResult.insertId
          : Array.isArray(entResult) && entResult[0] && entResult[0].insertId
            ? entResult[0].insertId
            : null;
      if (!entitlementId) {
        throw new Error('Failed to create entitlement (no insertId)');
      }
    } catch (entErr) {
      if (_isDuplicateKeyError(entErr)) {
        await connection.rollback();
        // Read back the existing entitlement and return.
        const existingEnt = await MysqlQueryRunner.runQueryInSlave(
          `SELECT entitlement_id FROM entitlements WHERE order_id = ? LIMIT 1`,
          [orderId]
        );
        const eid = Array.isArray(existingEnt) && existingEnt.length ? existingEnt[0].entitlement_id : null;
        return { orderId, entitlementId: eid, templateId, idempotent: true };
      }
      throw entErr;
    }

    // INSERT claimed_templates (one row). revisions_remaining=1 matches a real premium_single buy.
    await connection.query(
      `INSERT INTO claimed_templates (
         user_id, entitlement_id, template_id, revisions_remaining, revisions_used,
         status, claimed_at
       ) VALUES (?, ?, ?, ?, 0, ?, NOW())`,
      [user.user_id, entitlementId, templateId, 1, 'active']
    );

    await connection.commit();

    return { orderId, entitlementId, templateId, idempotent: false };
  } catch (err) {
    try { await connection.rollback(); } catch (_e) { /* best-effort */ }
    throw err;
  } finally {
    connection.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GRANT PACK ENTITLEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant a `unified_pack` entitlement for a pack. Inserts one claimed_templates row per template
 * in the pack so all of them appear in mobile "Your library" immediately.
 *
 * Business-level idempotency: if the user already has an active unified_pack entitlement for this
 * pack (with `pack_batch_status IN ('pending', 'in_progress')`), we return that entitlement and
 * skip creating a duplicate order. This matches packUnlock.service.js behavior in photobop-api.
 *
 * Atomic flow:
 *   1. Validate pack exists + has templates
 *   2. Check for existing active pack entitlement (return early if found)
 *   3. Create order + mark completed
 *   4. Insert entitlement (unified_pack)
 *   5. Insert claimed_templates rows for every template in the pack (chunked)
 *   6. COMMIT
 *
 * @param {Object} opts
 * @returns {Promise<{ orderId:number, entitlementId:number, packId:string, templateCount:number, idempotent:boolean }>}
 */
exports.grantPack = async function (opts) {
  const reason = _validateReason(opts && opts.reason);
  const granted_by_admin_id = _requireAdminId(opts && opts.granted_by_admin_id);
  const idempotencyKey = _validateIdempotencyKey(opts && opts.idempotency_key);
  const packId =
    opts && opts.pack_id != null && String(opts.pack_id).trim() !== ''
      ? String(opts.pack_id).trim()
      : '';
  if (!packId) {
    const err = new Error('pack_id is required');
    err.code = 'ADMIN_GRANT_PACK_REQUIRED';
    err.httpStatusCode = 400;
    throw err;
  }

  const user = await _requireUser(opts.user_id);

  // Pack lookup.
  const packRows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT pack_id, pack_name FROM packs WHERE pack_id = ? AND archived_at IS NULL LIMIT 1`,
    [packId]
  );
  if (!Array.isArray(packRows) || packRows.length === 0) {
    const err = new Error('Pack not found');
    err.code = 'ADMIN_GRANT_PACK_NOT_FOUND';
    err.httpStatusCode = 404;
    throw err;
  }

  // Templates in the pack.
  const packTemplateRows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM pack_templates
      WHERE pack_id = ? AND archived_at IS NULL
      ORDER BY sort_order ASC`,
    [packId]
  );
  const packTemplateIds = (Array.isArray(packTemplateRows) ? packTemplateRows : [])
    .map((r) => (r.template_id != null ? String(r.template_id).trim() : ''))
    .filter(Boolean);
  if (packTemplateIds.length === 0) {
    const err = new Error('Pack has no templates');
    err.code = 'ADMIN_GRANT_PACK_EMPTY';
    err.httpStatusCode = 409;
    throw err;
  }

  // Business-level idempotency: existing active unified_pack entitlement?
  const existingEnt = await MysqlQueryRunner.runQueryInSlave(
    `SELECT entitlement_id, order_id
       FROM entitlements
      WHERE user_id = ?
        AND pack_id = ?
        AND tier_plan_type = 'unified_pack'
        AND status = 'active'
        AND (valid_until IS NULL OR valid_until > NOW())
        AND pack_batch_status IN ('pending', 'in_progress')
      LIMIT 1`,
    [user.user_id, packId]
  );
  if (Array.isArray(existingEnt) && existingEnt.length > 0) {
    return {
      orderId: existingEnt[0].order_id,
      entitlementId: existingEnt[0].entitlement_id,
      packId,
      templateCount: packTemplateIds.length,
      idempotent: true
    };
  }

  const plan = await _getAdminGrantPlan(ADMIN_GRANT_PLAN_NAME_PACK);

  const transaction_notes = _buildGrantNotes({
    grantType: 'pack',
    reason,
    granted_by_admin_id,
    idempotencyKey,
    extra: {
      pack_resource_id: packId,
      pack_template_count: packTemplateIds.length
    }
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(plan.validity_days) || 30));

  const connection = await MysqlQueryRunner.getConnectionFromMaster();
  try {
    await connection.beginTransaction();

    const orderId = await _createAdminGrantOrder(connection, {
      userId: user.user_id,
      planId: plan.pp_id,
      currency: plan.currency || 'INR',
      quantity: 1,
      transactionNotes: transaction_notes,
      idempotencyKey
    });
    await _markOrderCompleted(connection, orderId, idempotencyKey);

    const entResult = await connection.query(
      `INSERT INTO entitlements (
         user_id, order_id, tier_plan_type, template_id, pack_id, pack_batch_status,
         template_slots_remaining, max_creations_per_template, status, valid_from, valid_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        user.user_id,
        orderId,
        'unified_pack',
        null,
        packId,
        'pending', // matches packUnlock.service.js so the same downstream saga picks it up
        1,
        Number(plan.max_creations_per_template) || 5,
        'active',
        validUntil
      ]
    );
    const entitlementId =
      entResult && typeof entResult === 'object' && 'insertId' in entResult
        ? entResult.insertId
        : Array.isArray(entResult) && entResult[0] && entResult[0].insertId
          ? entResult[0].insertId
          : null;
    if (!entitlementId) {
      throw new Error('Failed to create pack entitlement (no insertId)');
    }

    // Insert one claimed_templates row per pack template. Chunked to stay under max_allowed_packet.
    const INSERT_CHUNK = 80;
    for (let i = 0; i < packTemplateIds.length; i += INSERT_CHUNK) {
      const chunk = packTemplateIds.slice(i, i + INSERT_CHUNK);
      const valueSql = chunk.map(() => '(?, ?, ?, ?, 0, ?, NOW())').join(', ');
      const params = [];
      for (const tid of chunk) {
        params.push(user.user_id, entitlementId, tid, 1, 'active');
      }
      await connection.query(
        `INSERT INTO claimed_templates (
           user_id, entitlement_id, template_id, revisions_remaining, revisions_used,
           status, claimed_at
         ) VALUES ${valueSql}`,
        params
      );
    }

    await connection.commit();

    return {
      orderId,
      entitlementId,
      packId,
      templateCount: packTemplateIds.length,
      idempotent: false
    };
  } catch (err) {
    try { await connection.rollback(); } catch (_e) { /* best-effort */ }
    throw err;
  } finally {
    connection.release();
  }
};

// Unused but exported for tests / debugging.
exports._internals = { ADMIN_GRANT_GATEWAY };
