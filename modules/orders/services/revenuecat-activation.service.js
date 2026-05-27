'use strict';

/**
 * Admin-only RevenueCat subscription backfill — writes MySQL `subscriptions` (+ optional credits
 * mirrored from SubscriptionService.initializeSubscriptionCredits) inside one master transaction.
 * Does not touch `api/` or RevenueCat REST. See plan: RevenueCat orphans admin tab.
 */

const moment = require('moment');
const { v7: uuidv7 } = require('uuid');
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

const ACTIVE_SUBSCRIPTION_STATUSES = [
  'active',
  'renewed',
  'pending',
  'trial',
  'paused',
  'upgraded',
  'active_non_recurring',
  'upgraded_non_recurring',
  'pending_otp_verification_for_upgrade'
];

function subscriptionPeriodEndMs(row) {
  const end = row.current_period_end || row.renews_at || row.end_at;
  if (!end) return null;
  const t = new Date(end).getTime();
  return Number.isNaN(t) ? null : t;
}

function periodEndStillValid(row) {
  const endMs = subscriptionPeriodEndMs(row);
  if (endMs == null) return true;
  return endMs > Date.now();
}

/** Mirrors api subscription.model recurringRowIsEntitled for reconciliation display / gating. */
function recurringRowIsEntitled(row) {
  if (!row) return false;
  if (ACTIVE_SUBSCRIPTION_STATUSES.includes(row.status)) {
    return periodEndStillValid(row);
  }
  if (row.status === 'cancelled' || row.status === 'paused') {
    const endMs = subscriptionPeriodEndMs(row);
    return endMs != null && endMs > Date.now();
  }
  return false;
}

function httpError(code, msg, httpStatusCode) {
  const err = new Error(msg);
  err.code = code;
  err.httpStatusCode = httpStatusCode || 400;
  return err;
}

function validateReason(reason) {
  const s = reason != null ? String(reason).trim() : '';
  if (s.length < 10 || s.length > 500) {
    throw httpError('RC_ACTIVATE_INVALID_REASON', 'Reason is required and must be 10–500 characters', 400);
  }
  return s;
}

function _isDuplicateKeyError(err) {
  return (
    err &&
    (err.code === 'ER_DUP_ENTRY' ||
      err.errno === 1062 ||
      (typeof err.message === 'string' &&
        (err.message.includes('Duplicate entry') || err.message.includes('unique_idempotency_key'))))
  );
}

/**
 * Resolve RevenueCat/store product IDs to canonical `payment_plans` rows in bulk.
 * Mirrors admin analytics resolution: numeric `pp_id`, then gateway SKUs (`pg_plan_id` /
 * `_ios` / `_android`), then legacy `subscription_plans.provider_plan_id`.
 *
 * @param {Array<string|number>} rawIds
 * @returns {Promise<Map<string, object>>}
 */
async function bulkResolvePlansForRcProductIds(rawIds) {
  const ids = [...new Set((rawIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map((n) => parseInt(n, 10));
  if (numericIds.length) {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `
      SELECT pp_id AS subscription_plan_id, plan_type AS subscription_type, plan_name AS subscription_name,
             current_price AS price, currency, billing_interval, credits, bonus_credits
      FROM payment_plans
      WHERE pp_id IN (?)
    `,
      [numericIds]
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      map.set(String(r.subscription_plan_id), r);
    }
  }

  const stringSkuNeedingDb = [...new Set(ids.filter((id) => !map.has(id) && !/^\d+$/.test(id)))];
  if (stringSkuNeedingDb.length) {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `
      SELECT pp.pp_id AS subscription_plan_id,
             pp.plan_type AS subscription_type,
             pp.plan_name AS subscription_name,
             pp.current_price AS price,
             pp.currency,
             pp.billing_interval,
             pp.credits,
             pp.bonus_credits,
             pgp.pg_plan_id,
             pgp.pg_plan_id_ios,
             pgp.pg_plan_id_android
      FROM payment_gateway_plans pgp
      INNER JOIN payment_plans pp ON pp.pp_id = pgp.payment_plan_id
      WHERE pgp.is_active = 1
        AND (
          pgp.pg_plan_id IN (?)
          OR pgp.pg_plan_id_ios IN (?)
          OR pgp.pg_plan_id_android IN (?)
        )
    `,
      [stringSkuNeedingDb, stringSkuNeedingDb, stringSkuNeedingDb]
    );
    /** @type {Set<string>} */
    const skuSet = new Set(stringSkuNeedingDb);
    function rowShape(r) {
      return {
        subscription_plan_id: r.subscription_plan_id,
        subscription_type: r.subscription_type,
        subscription_name: r.subscription_name,
        price: r.price,
        currency: r.currency,
        billing_interval: r.billing_interval,
        credits: r.credits,
        bonus_credits: r.bonus_credits
      };
    }
    for (const r of Array.isArray(rows) ? rows : []) {
      const shape = rowShape(r);
      for (const key of ['pg_plan_id', 'pg_plan_id_ios', 'pg_plan_id_android']) {
        const cell = r[key];
        if (cell == null || String(cell).trim() === '') continue;
        const sku = String(cell).trim();
        if (skuSet.has(sku) && !map.has(sku)) map.set(sku, shape);
      }
    }

    const unresolvedExact = stringSkuNeedingDb.filter((id) => !map.has(id));
    if (unresolvedExact.length) {
      const lowerToCsv = new Map();
      for (const id of unresolvedExact) lowerToCsv.set(String(id).toLowerCase(), id);
      for (const r of Array.isArray(rows) ? rows : []) {
        const shape = rowShape(r);
        for (const key of ['pg_plan_id', 'pg_plan_id_ios', 'pg_plan_id_android']) {
          const cell = r[key];
          if (cell == null || String(cell).trim() === '') continue;
          const skuLc = String(cell).trim().toLowerCase();
          const orig = lowerToCsv.get(skuLc);
          if (orig && !map.has(orig)) map.set(orig, shape);
        }
      }
    }
  }

  const stillMissing = ids.filter((id) => !map.has(id));
  if (stillMissing.length) {
    try {
      const spl = await MysqlQueryRunner.runQueryInSlave(
        `
        SELECT subscription_plan_id,
               subscription_type,
               subscription_name,
               price,
               currency,
               billing_interval,
               credits,
               bonus_credits,
               provider_plan_id
        FROM subscription_plans
        WHERE archived_at IS NULL
          AND provider_plan_id IN (?)
      `,
        [stillMissing]
      );
      for (const r of Array.isArray(spl) ? spl : []) {
        const pk =
          r && r.provider_plan_id != null && String(r.provider_plan_id).trim() !== ''
            ? String(r.provider_plan_id).trim()
            : '';
        if (!pk || map.has(pk)) continue;
        map.set(pk, {
          subscription_plan_id: r.subscription_plan_id,
          subscription_type: r.subscription_type,
          subscription_name: r.subscription_name,
          price: r.price,
          currency: r.currency,
          billing_interval: r.billing_interval,
          credits: r.credits,
          bonus_credits: r.bonus_credits
        });
      }
    } catch (_e) {
      /* Older DBs without subscription_plans or columns */
    }
  }

  return map;
}

/**
 * Same resolved shape used by webhook activation (single SKU).
 * @returns {Promise<{subscription_plan_id, subscription_type, subscription_name, price, currency, billing_interval, credits, bonus_credits}|null>}
 */
async function getSubscriptionPlanDetails(planId) {
  const pid = planId != null ? String(planId).trim() : '';
  if (!pid) return null;
  const m = await bulkResolvePlansForRcProductIds([pid]);
  return m.get(pid) || null;
}

async function requireActiveUser(userId) {
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT user_id, email, status, DELETED_AT FROM user WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw httpError('RC_ACTIVATE_USER_NOT_FOUND', 'Target user not found', 404);
  }
  if (rows[0].DELETED_AT) {
    throw httpError('RC_ACTIVATE_USER_DELETED', 'Target user is deleted', 409);
  }
  if (rows[0].status && String(rows[0].status).toLowerCase() === 'deactivated') {
    throw httpError('RC_ACTIVATE_USER_DEACTIVATED', 'Target user is deactivated', 409);
  }
  return rows[0];
}

/**
 * MySQL `TIMESTAMP` columns only support ~1970–2038 UTC. RevenueCat exports often use far-future
 * expirations (e.g. 2099); clamp so INSERT does not fail with ER_WRONG_VALUE.
 * @see db-migrations/migrations/sqls/20250210062447-alter-subscriptions-table-up.sql
 */
const MYSQL_TIMESTAMP_MIN_MS = Date.UTC(1970, 0, 1, 0, 0, 2);
/** Well inside MySQL TIMESTAMP upper bound (2038-01-19 03:14:07 UTC). */
const MYSQL_TIMESTAMP_MAX_MS = Date.UTC(2038, 0, 18, 23, 59, 59);

function parseExpiryToMysqlDatetime(expiresRaw) {
  if (expiresRaw == null || expiresRaw === '') return null;
  const s = String(expiresRaw).trim();
  if (!s) return null;
  let ms;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const rawMs = s.length <= 10 ? n * 1000 : n;
    const d = new Date(rawMs);
    if (Number.isNaN(d.getTime())) return null;
    ms = d.getTime();
  } else {
    const d = moment(s);
    if (!d.isValid()) return null;
    ms = d.valueOf();
  }
  if (ms > MYSQL_TIMESTAMP_MAX_MS) ms = MYSQL_TIMESTAMP_MAX_MS;
  if (ms < MYSQL_TIMESTAMP_MIN_MS) ms = MYSQL_TIMESTAMP_MIN_MS;
  /** UTC wall clock: local `.format()` pushed clamped UTC past MySQL max when session TZ is +00:00. */
  return moment.utc(ms).format('YYYY-MM-DD HH:mm:ss');
}

/** Same clamp rules as {@link parseExpiryToMysqlDatetime}. */
function parsePurchaseDateToMysqlDatetime(purchaseRaw) {
  return parseExpiryToMysqlDatetime(purchaseRaw);
}

/**
 * Prefer RevenueCat CSV purchase time so admin backfill does not sort as "bought today".
 * @param {object} opts activate payload
 * @param {string} periodEndSql
 * @param {string} billingInterval
 * @param {string|null} existingStartAtSql when refreshing a stale row in place
 */
function resolveSubscriptionStartAtSql(opts, periodEndSql, billingInterval, existingStartAtSql) {
  const fromCsv = parsePurchaseDateToMysqlDatetime(opts && opts.purchase_date);
  if (fromCsv) return fromCsv;
  if (existingStartAtSql) return existingStartAtSql;

  const endM = moment.utc(periodEndSql, 'YYYY-MM-DD HH:mm:ss');
  if (!endM.isValid()) {
    return moment.utc().format('YYYY-MM-DD HH:mm:ss');
  }
  const bi = billingInterval != null ? String(billingInterval).toLowerCase() : '';
  if (bi === 'yearly') return endM.clone().subtract(1, 'year').format('YYYY-MM-DD HH:mm:ss');
  if (bi === 'monthly') return endM.clone().subtract(1, 'month').format('YYYY-MM-DD HH:mm:ss');
  return endM.clone().subtract(30, 'days').format('YYYY-MM-DD HH:mm:ss');
}

function mergeAdditionalDataForAdminPatch(existingRaw, patch) {
  let base = {};
  if (existingRaw != null && existingRaw !== '') {
    try {
      base = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : { ...existingRaw };
    } catch (_e) {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

/** Admin orphan activation audit — stored on `subscriptions.additional_data`, not a separate table. */
function adminReconciliationAdditionalPatch({
  runId,
  userId,
  providerSubscriptionId,
  productId,
  refreshedInPlace
}) {
  return {
    reconciliation: {
      source: 'admin_orphans',
      run_id: runId,
      user_id: userId,
      provider_subscription_id: providerSubscriptionId,
      product_id: productId,
      bucket: 'ADMIN_ACTIVATED',
      action: refreshedInPlace ? 'refreshed' : 'activated',
      recorded_at_utc: moment.utc().format('YYYY-MM-DD HH:mm:ss.SSS')
    }
  };
}

/**
 * Latest existing RC recurring row for this user+SKU (used to tag admin activation as renewal).
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<unknown> }} conn
 */
async function loadLatestPriorRcRecurringForPlan(conn, userId, providerPlanId) {
  const rows = await conn.query(
    `
    SELECT subscription_id, additional_data
    FROM subscriptions
    WHERE user_id = ?
      AND provider = 'revenuecat'
      AND payment_type = 'recurring'
      AND TRIM(COALESCE(provider_plan_id, '')) = TRIM(?)
    ORDER BY COALESCE(start_at, created_at) DESC, created_at DESC, subscription_id DESC
    LIMIT 1
  `,
    [userId, providerPlanId]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

function renewalCountFromPriorAdditionalData(raw) {
  if (raw == null || raw === '') return 0;
  try {
    const ad = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!ad || ad.renewal_count == null) return 0;
    const n = Number(ad.renewal_count);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (_e) {
    return 0;
  }
}

/**
 * @param {object} opts
 * @returns {Promise<{ subscription_id:string, creditsGranted:number, idempotent:boolean }>}
 */
exports.activateFromAdmin = async function (opts) {
  const reason = validateReason(opts && opts.reason);
  const grantedByAdminId =
    opts && opts.granted_by_admin_id != null ? String(opts.granted_by_admin_id).trim() : '';
  if (!grantedByAdminId) {
    throw httpError('RC_ACTIVATE_MISSING_ADMIN', 'granted_by_admin_id is required', 400);
  }

  const userId = opts && opts.user_id != null ? String(opts.user_id).trim() : '';
  const productId = opts && opts.product_id != null ? String(opts.product_id).trim() : '';
  const providerSubscriptionId =
    opts && opts.provider_subscription_id != null ? String(opts.provider_subscription_id).trim() : '';

  if (!userId || !productId || !providerSubscriptionId) {
    throw httpError(
      'RC_ACTIVATE_BAD_INPUT',
      'user_id, product_id, and provider_subscription_id are required',
      400
    );
  }

  if (providerSubscriptionId.startsWith('$RCAnonymousID')) {
    throw httpError('RC_ACTIVATE_ANONYMOUS', 'Cannot activate RevenueCat anonymous subscribers', 400);
  }

  const includeCredits = !!(opts && opts.include_credits);
  const runId =
    opts && opts.run_id != null && String(opts.run_id).trim() !== ''
      ? String(opts.run_id).trim()
      : uuidv7();

  await requireActiveUser(userId);

  const plan = await getSubscriptionPlanDetails(productId);
  if (!plan) {
    throw httpError('RC_ACTIVATE_PLAN_NOT_FOUND', `No payment plan mapped for product/SKU "${productId}"`, 404);
  }

  const billingInterval = plan.billing_interval != null ? String(plan.billing_interval).toLowerCase() : '';
  if (billingInterval === 'onetime') {
    throw httpError('RC_ACTIVATE_ONETIME_PLAN', 'Cannot activate subscription for one-time / onetime billing plan mapping', 400);
  }

  const periodEndSql = parseExpiryToMysqlDatetime(opts && opts.expires_date);
  if (!periodEndSql) {
    throw httpError('RC_ACTIVATE_BAD_EXPIRY', 'expires_date is missing or invalid', 400);
  }

  const nowSql = moment().format('YYYY-MM-DD HH:mm:ss');
  const existingSubscriptionId =
    opts && opts.existing_subscription_id != null && String(opts.existing_subscription_id).trim() !== ''
      ? String(opts.existing_subscription_id).trim()
      : null;

  let refreshSubscriptionId = existingSubscriptionId;

  const existingRows = await MysqlQueryRunner.runQueryInSlave(
    `
    SELECT subscription_id, user_id, provider_subscription_id, status,
           current_period_end, renews_at, end_at, payment_type, provider
    FROM subscriptions
    WHERE provider_subscription_id = ?
    LIMIT 1
  `,
    [providerSubscriptionId]
  );
  if (Array.isArray(existingRows) && existingRows.length > 0) {
    const row = existingRows[0];
    if (String(row.user_id) !== String(userId)) {
      throw httpError(
        'RC_ACTIVATE_PROVIDER_ID_CONFLICT',
        'provider_subscription_id already belongs to a different user',
        409
      );
    }
    const rowProvider =
      row.provider != null ? String(row.provider).trim().toLowerCase() : '';
    const rowIsRevenueCat = rowProvider === 'revenuecat';
    if (recurringRowIsEntitled(row) && rowIsRevenueCat && !includeCredits) {
      return {
        subscription_id: row.subscription_id,
        creditsGranted: 0,
        idempotent: true,
        idempotent_reason: 'already_entitled_revenuecat'
      };
    }
    refreshSubscriptionId = String(row.subscription_id);
  }

  let subscriptionId = uuidv7();
  const currency = plan.currency || 'INR';
  const initialCreditsTotal = Number(plan.credits || 0) + Number(plan.bonus_credits || 0);

  const syntheticCustomerListId =
    /^rc_clist_[a-f0-9]{48}$/.test(String(providerSubscriptionId || '').trim());

  const conn = await MysqlQueryRunner.getConnectionFromMaster();
  try {
    await conn.beginTransaction();

    let startAtSql = resolveSubscriptionStartAtSql(opts, periodEndSql, billingInterval, null);
    let refreshedInPlace = false;

    if (refreshSubscriptionId) {
      const staleRows = await conn.query(
        `
        SELECT subscription_id, user_id, start_at, additional_data, provider_subscription_id
        FROM subscriptions
        WHERE subscription_id = ?
        LIMIT 1
      `,
        [refreshSubscriptionId]
      );
      const staleRow =
        Array.isArray(staleRows) && staleRows.length > 0 ? staleRows[0] : null;
      if (!staleRow || String(staleRow.user_id) !== String(userId)) {
        throw httpError('RC_ACTIVATE_STALE_SUB_NOT_FOUND', 'Existing subscription row not found for user', 404);
      }
      subscriptionId = String(staleRow.subscription_id);
      const existingStart =
        staleRow.start_at != null
          ? moment.utc(staleRow.start_at).format('YYYY-MM-DD HH:mm:ss')
          : null;
      startAtSql = resolveSubscriptionStartAtSql(opts, periodEndSql, billingInterval, existingStart);

      const patchAdditional = mergeAdditionalDataForAdminPatch(staleRow.additional_data, {
        admin_activation: true,
        admin_reason: reason,
        granted_by_admin_id: grantedByAdminId,
        run_id: runId,
        mimic_event: 'ADMIN_REFRESH',
        ...(syntheticCustomerListId ? { customer_list_csv_missing_store_tx_id: true } : {}),
        provider_notes: {
          user_id: userId,
          provider: 'revenuecat',
          type: 'regular'
        },
        ...adminReconciliationAdditionalPatch({
          runId,
          userId,
          providerSubscriptionId,
          productId,
          refreshedInPlace: true
        })
      });

      const effectiveTxId =
        providerSubscriptionId &&
        !String(providerSubscriptionId).startsWith('rc_clist_') &&
        staleRow.provider_subscription_id !== providerSubscriptionId
          ? providerSubscriptionId
          : staleRow.provider_subscription_id || providerSubscriptionId;

      await conn.query(
        `
        UPDATE subscriptions SET
          provider = 'revenuecat',
          provider_plan_id = ?,
          status = 'active',
          provider_subscription_id = ?,
          current_period_start = ?,
          current_period_end = ?,
          renews_at = ?,
          start_at = COALESCE(start_at, ?),
          additional_data = ?,
          updated_at = NOW()
        WHERE subscription_id = ? AND user_id = ?
      `,
        [
          productId,
          effectiveTxId,
          startAtSql,
          periodEndSql,
          periodEndSql,
          startAtSql,
          patchAdditional,
          subscriptionId,
          userId
        ]
      );
      refreshedInPlace = true;
    }

    if (!refreshedInPlace) {
      const priorRow = await loadLatestPriorRcRecurringForPlan(conn, userId, productId);
      let mimicEvent = 'INITIAL_PURCHASE';
      /** @type {Record<string, unknown>} */
      const renewalMeta = {};
      if (priorRow && priorRow.subscription_id != null) {
        const prevId = String(priorRow.subscription_id).trim();
        if (prevId) {
          renewalMeta.previous_subscription_id = prevId;
          const prevRc = renewalCountFromPriorAdditionalData(priorRow.additional_data);
          renewalMeta.renewal_count = Math.max(1, prevRc + 1);
          mimicEvent = 'SUBSCRIPTION_RENEWED';
        }
      }

      startAtSql = resolveSubscriptionStartAtSql(opts, periodEndSql, billingInterval, null);

      const additionalData = JSON.stringify({
        admin_activation: true,
        admin_reason: reason,
        granted_by_admin_id: grantedByAdminId,
        run_id: runId,
        mimic_event: mimicEvent,
        ...renewalMeta,
        ...(syntheticCustomerListId ? { customer_list_csv_missing_store_tx_id: true } : {}),
        provider_notes: {
          user_id: userId,
          provider: 'revenuecat',
          type: 'regular'
        },
        ...adminReconciliationAdditionalPatch({
          runId,
          userId,
          providerSubscriptionId,
          productId,
          refreshedInPlace: false
        })
      });

      await conn.query(
        `
        INSERT INTO subscriptions (
          subscription_id,
          user_id,
          provider,
          payment_type,
          currency,
          provider_subscription_id,
          provider_plan_id,
          status,
          total_count,
          start_at,
          end_at,
          current_period_start,
          current_period_end,
          renews_at,
          additional_data,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NOW(), NOW())
      `,
        [
          subscriptionId,
          userId,
          'revenuecat',
          'recurring',
          currency,
          providerSubscriptionId,
          productId,
          'active',
          999,
          startAtSql,
          startAtSql,
          periodEndSql,
          periodEndSql,
          additionalData
        ]
      );
    }

    const creditExtras = {
      reason: 'admin_revenuecat_activation',
      plan_id: productId,
      credit_type: 'initial_allocation',
      plan_type: plan.subscription_type,
      billing_interval: plan.billing_interval,
      mimic: 'initializeSubscriptionCredits',
      granted_by_admin_id: grantedByAdminId
    };

    let creditsGranted = 0;

    if (includeCredits && initialCreditsTotal > 0) {
      const schExisting = await conn.query(
        `SELECT 1 AS ok FROM subscription_credit_history WHERE subscription_id = ? LIMIT 1`,
        [subscriptionId]
      );
      const hasSch = Array.isArray(schExisting) && schExisting.length > 0;
      const ledgerExisting = await conn.query(
        `
        SELECT 1 AS ok FROM credits_transactions
        WHERE user_id = ?
          AND reference_id COLLATE utf8mb4_unicode_ci = ?
          AND status = 'completed'
        LIMIT 1
      `,
        [userId, subscriptionId]
      );
      const hasLedger = Array.isArray(ledgerExisting) && ledgerExisting.length > 0;
      if (hasSch && hasLedger) {
        await conn.commit();
        return {
          subscription_id: subscriptionId,
          creditsGranted: 0,
          idempotent: true,
          idempotent_reason: 'credits_already_on_subscription',
          refreshed_in_place: refreshedInPlace,
          plan: {
            subscription_plan_id: plan.subscription_plan_id,
            subscription_name: plan.subscription_name,
            billing_interval: plan.billing_interval
          }
        };
      }

      if (!hasSch) {
        const creditHistoryId = uuidv7();
        await conn.query(
          `
          INSERT INTO subscription_credit_history (
            subscription_credits_id, user_id, subscription_id, credits, additional_data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [
            creditHistoryId,
            userId,
            subscriptionId,
            initialCreditsTotal,
            JSON.stringify(creditExtras),
            startAtSql,
            startAtSql
          ]
        );
      }

      const descriptionBase = `RevenueCat admin activation: ${reason}`.slice(0, 255);

      if (Number(plan.credits) > 0) {
        const idemp = `sub:${userId}:${subscriptionId}:regular`;
        await conn.query(
          `
          INSERT INTO credits_transactions (
            user_id, transaction_type, amount, status,
            reference_type, reference_id, description, idempotency_key,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
          [
            userId,
            'subscription_initial',
            Number(plan.credits),
            'completed',
            'subscription_credits',
            subscriptionId,
            `${descriptionBase} — regular credits`,
            idemp
          ]
        );
      }

      if (Number(plan.bonus_credits) > 0) {
        const idempB = `sub:${userId}:${subscriptionId}:bonus`;
        await conn.query(
          `
          INSERT INTO credits_transactions (
            user_id, transaction_type, amount, status,
            reference_type, reference_id, description, idempotency_key,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
          [
            userId,
            'subscription_initial',
            Number(plan.bonus_credits),
            'completed',
            'bonus_credits',
            subscriptionId,
            `${descriptionBase} — bonus credits`,
            idempB
          ]
        );
      }

      await conn.query(
        `
        INSERT INTO user_credits (user_id, balance, reserved_balance, updated_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          balance = balance + ?,
          updated_at = CURRENT_TIMESTAMP
      `,
        [userId, initialCreditsTotal, initialCreditsTotal]
      );

      creditsGranted = initialCreditsTotal;
    }

    await conn.commit();

    return {
      subscription_id: subscriptionId,
      creditsGranted,
      idempotent: false,
      refreshed_in_place: refreshedInPlace,
      plan: {
        subscription_plan_id: plan.subscription_plan_id,
        subscription_name: plan.subscription_name,
        billing_interval: plan.billing_interval
      }
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_e) {
      /* noop */
    }
    if (_isDuplicateKeyError(err)) {
      const again = await MysqlQueryRunner.runQueryInSlave(
        `SELECT subscription_id FROM subscriptions WHERE provider_subscription_id = ? LIMIT 1`,
        [providerSubscriptionId]
      );
      if (Array.isArray(again) && again.length > 0) {
        return { subscription_id: again[0].subscription_id, creditsGranted: 0, idempotent: true };
      }
    }
    throw err;
  } finally {
    conn.release();
  }
};

exports.getSubscriptionPlanDetails = getSubscriptionPlanDetails;
exports.bulkResolvePlansForRcProductIds = bulkResolvePlansForRcProductIds;
exports.recurringRowIsEntitled = recurringRowIsEntitled;
