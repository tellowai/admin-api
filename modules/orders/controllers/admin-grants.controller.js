'use strict';

/**
 * HTTP controller for admin grants. Single-process flow (no proxy):
 *   isAdminUser  -> isOwner()  -> [this controller] :
 *      1. Validate body (presence + ranges + UUID shape).
 *      2. Reserve a daily-cap slot atomically (`AdminGrantDailyCounter.tryReserve`). 429 on breach.
 *      3. Call local `AdminGrantService.grant*` which runs ONE master DB transaction:
 *         orders + credits_transactions/user_credits OR orders + entitlements + claimed_templates.
 *      4. Emit `publishNewAdminActivityLog` for audit (success + failure paths both).
 *
 * Why "all in admin-api" and not split with photobop-api:
 *   - Admin-api already owns the database connection. One transaction with no inter-service hop
 *     means we can't end up with a half-finalized grant if a network timeout fires mid-call.
 *   - No shared-secret config to leak.
 *   - One log stream (admin-api) for one audit trail.
 */

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AdminGrantService = require('../services/admin-grant.service');
const AdminGrantDailyCounter = require('../models/admin-grant-daily-counter.model');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');

// ─── Synchronous request validators ──────────────────────────────────────────

function _badRequest(res, message, code) {
  return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
    message,
    code: code || 'ADMIN_GRANT_VALIDATION_ERROR'
  });
}

function _validateUserIdParam(req, res) {
  const userId = String(req.params.userId || '').trim();
  if (!userId) {
    _badRequest(res, 'userId path param is required', 'ADMIN_GRANT_USER_ID_REQUIRED');
    return null;
  }
  return userId;
}

function _validateReason(reasonRaw) {
  const reason = reasonRaw != null ? String(reasonRaw).trim() : '';
  if (reason.length < 10 || reason.length > 500) {
    const err = new Error('reason is required and must be 10-500 characters');
    err.code = 'ADMIN_GRANT_INVALID_REASON';
    throw err;
  }
  return reason;
}

function _validateIdempotencyKey(keyRaw) {
  const k = keyRaw != null ? String(keyRaw).trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k)) {
    const err = new Error('idempotency_key must be a UUID');
    err.code = 'ADMIN_GRANT_BAD_IDEMPOTENCY_KEY';
    throw err;
  }
  return k;
}

/** Translate a service-thrown error (with `httpStatusCode` + `code`) into an HTTP response. */
function _sendServiceError(res, err, fallbackCode) {
  const status = err && err.httpStatusCode ? err.httpStatusCode : HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
  return res.status(status).json({
    message: (err && err.message) || 'Admin grant failed',
    code: (err && err.code) || fallbackCode
  });
}

async function _emitActivityLogSafe(payload) {
  try {
    await publishNewAdminActivityLog(payload);
  } catch (logErr) {
    console.error('admin grant activity log emit failed', logErr);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/users/:userId/grants/credits
// ─────────────────────────────────────────────────────────────────────────────

exports.grantCredits = async function (req, res) {
  const userId = _validateUserIdParam(req, res);
  if (!userId) return;

  let reason;
  let idempotencyKey;
  let credits;
  try {
    const body = req.body || {};
    reason = _validateReason(body.reason);
    idempotencyKey = _validateIdempotencyKey(body.idempotency_key);
    credits = Number(body.credits_amount);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 100000 || !Number.isInteger(credits)) {
      const err = new Error('credits_amount must be a positive integer (max 100000)');
      err.code = 'ADMIN_GRANT_INVALID_CREDITS';
      throw err;
    }
  } catch (validationErr) {
    return _badRequest(res, validationErr.message, validationErr.code);
  }

  // Daily-cap reservation. Atomic; throws 429 on breach.
  try {
    await AdminGrantDailyCounter.tryReserve({
      adminUserId: req.user.userId,
      creditsDelta: credits,
      entitlementsDelta: 0
    });
  } catch (capErr) {
    return res.status(capErr.httpStatusCode || 429).json({
      message: capErr.message,
      code: capErr.code || 'ADMIN_GRANT_DAILY_CAP',
      caps: capErr.caps,
      current: capErr.current
    });
  }

  try {
    const result = await AdminGrantService.grantCredits({
      user_id: userId,
      credits_amount: credits,
      reason,
      granted_by_admin_id: String(req.user.userId),
      idempotency_key: idempotencyKey
    });

    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_CREDITS',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        credits_amount: credits,
        reason,
        idempotency_key: idempotencyKey,
        result_order_id: result.orderId,
        new_balance: result.newBalance,
        idempotent_replay: !!result.idempotent
      }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: result,
      message: result.idempotent
        ? 'Credits already granted (idempotent replay)'
        : 'Credits granted'
    });
  } catch (err) {
    console.error('admin_grant_credits failed', { error: err && err.message, code: err && err.code });
    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_CREDITS_FAILED',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        credits_amount: credits,
        reason,
        idempotency_key: idempotencyKey,
        error_message: err && err.message,
        error_code: err && err.code
      }
    });
    return _sendServiceError(res, err, 'ADMIN_GRANT_CREDITS_ERROR');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/users/:userId/grants/template-entitlement
// ─────────────────────────────────────────────────────────────────────────────

exports.grantTemplateEntitlement = async function (req, res) {
  const userId = _validateUserIdParam(req, res);
  if (!userId) return;

  let reason;
  let idempotencyKey;
  let templateId;
  try {
    const body = req.body || {};
    reason = _validateReason(body.reason);
    idempotencyKey = _validateIdempotencyKey(body.idempotency_key);
    templateId = body.template_id != null && String(body.template_id).trim() !== ''
      ? String(body.template_id).trim()
      : '';
    if (!templateId) {
      const err = new Error('template_id is required');
      err.code = 'ADMIN_GRANT_TEMPLATE_REQUIRED';
      throw err;
    }
  } catch (validationErr) {
    return _badRequest(res, validationErr.message, validationErr.code);
  }

  try {
    await AdminGrantDailyCounter.tryReserve({
      adminUserId: req.user.userId,
      creditsDelta: 0,
      entitlementsDelta: 1
    });
  } catch (capErr) {
    return res.status(capErr.httpStatusCode || 429).json({
      message: capErr.message,
      code: capErr.code || 'ADMIN_GRANT_DAILY_CAP',
      caps: capErr.caps,
      current: capErr.current
    });
  }

  try {
    const result = await AdminGrantService.grantTemplate({
      user_id: userId,
      template_id: templateId,
      reason,
      granted_by_admin_id: String(req.user.userId),
      idempotency_key: idempotencyKey
    });

    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_TEMPLATE_ENTITLEMENT',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        template_id: templateId,
        reason,
        idempotency_key: idempotencyKey,
        result_order_id: result.orderId,
        result_entitlement_id: result.entitlementId,
        idempotent_replay: !!result.idempotent
      }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: result,
      message: result.idempotent
        ? 'Entitlement already exists (idempotent replay)'
        : 'Template entitlement granted'
    });
  } catch (err) {
    console.error('admin_grant_template failed', { error: err && err.message, code: err && err.code });
    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_TEMPLATE_ENTITLEMENT_FAILED',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        template_id: templateId,
        reason,
        idempotency_key: idempotencyKey,
        error_message: err && err.message,
        error_code: err && err.code
      }
    });
    return _sendServiceError(res, err, 'ADMIN_GRANT_TEMPLATE_ENTITLEMENT_ERROR');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/users/:userId/grants/pack-entitlement
// ─────────────────────────────────────────────────────────────────────────────

exports.grantPackEntitlement = async function (req, res) {
  const userId = _validateUserIdParam(req, res);
  if (!userId) return;

  let reason;
  let idempotencyKey;
  let packId;
  try {
    const body = req.body || {};
    reason = _validateReason(body.reason);
    idempotencyKey = _validateIdempotencyKey(body.idempotency_key);
    packId = body.pack_id != null && String(body.pack_id).trim() !== ''
      ? String(body.pack_id).trim()
      : '';
    if (!packId) {
      const err = new Error('pack_id is required');
      err.code = 'ADMIN_GRANT_PACK_REQUIRED';
      throw err;
    }
  } catch (validationErr) {
    return _badRequest(res, validationErr.message, validationErr.code);
  }

  try {
    await AdminGrantDailyCounter.tryReserve({
      adminUserId: req.user.userId,
      creditsDelta: 0,
      entitlementsDelta: 1
    });
  } catch (capErr) {
    return res.status(capErr.httpStatusCode || 429).json({
      message: capErr.message,
      code: capErr.code || 'ADMIN_GRANT_DAILY_CAP',
      caps: capErr.caps,
      current: capErr.current
    });
  }

  try {
    const result = await AdminGrantService.grantPack({
      user_id: userId,
      pack_id: packId,
      reason,
      granted_by_admin_id: String(req.user.userId),
      idempotency_key: idempotencyKey
    });

    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_PACK_ENTITLEMENT',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        pack_id: packId,
        reason,
        idempotency_key: idempotencyKey,
        result_order_id: result.orderId,
        result_entitlement_id: result.entitlementId,
        template_count: result.templateCount,
        idempotent_replay: !!result.idempotent
      }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: result,
      message: result.idempotent
        ? 'Pack entitlement already exists (idempotent replay)'
        : 'Pack entitlement granted'
    });
  } catch (err) {
    console.error('admin_grant_pack failed', { error: err && err.message, code: err && err.code });
    await _emitActivityLogSafe({
      adminUserId: req.user.userId,
      entityType: 'USER',
      actionName: 'ADMIN_GRANT_PACK_ENTITLEMENT_FAILED',
      entityId: String(userId),
      additionalData: {
        target_user_id: userId,
        pack_id: packId,
        reason,
        idempotency_key: idempotencyKey,
        error_message: err && err.message,
        error_code: err && err.code
      }
    });
    return _sendServiceError(res, err, 'ADMIN_GRANT_PACK_ENTITLEMENT_ERROR');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/users/grants/daily-usage  — read-only "what's left today" for UI
// ─────────────────────────────────────────────────────────────────────────────

exports.getDailyUsage = async function (req, res) {
  try {
    const data = await AdminGrantDailyCounter.getTodayUsage(req.user.userId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    console.error('getDailyUsage error', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Failed to load admin grant daily usage'
    });
  }
};
