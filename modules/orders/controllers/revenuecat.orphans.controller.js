'use strict';

const Papa = require('papaparse');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const ActivationService = require('../services/revenuecat-activation.service');
const GenerationsModel = require('../../generations/models/generations.model');

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

exports.multerCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, _file, cb) => cb(null, true)
}).single('file');

function pairKey(uid, pid) {
  return `${uid}::${pid}`;
}

/**
 * RevenueCat customer-list exports often use semicolon delimiters; scheduled transaction exports use commas.
 */
function detectCsvDelimiter(text) {
  const sample = String(text || '').slice(0, 65536);
  const lines = sample.split(/\r?\n/).filter((l) => String(l).trim());
  const line = lines[0] || '';
  if (!line) return ',';
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  if (semi > 1 && semi >= comma) return ';';
  return ',';
}

/** Split RevenueCat CSV fields like `all_purchased_products_ids` ("a,b,c" or JSON array). */
function splitPurchasedProductIds(raw) {
  if (raw == null || raw === '') return [];
  let s = String(raw).trim();
  if (!s) return [];
  const unquoted = s.replace(/^['"]+|['"]+$/g, '');
  if (unquoted.startsWith('[')) {
    try {
      const j = JSON.parse(unquoted);
      if (Array.isArray(j)) {
        return [...new Set(j.map((x) => String(x).trim()).filter(Boolean))];
      }
    } catch (_e) {
      /* fall through — treat as plain string */
    }
  }
  return [...new Set(s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean))];
}

function normalizeHeaders(row) {
  const out = {};
  if (!row || typeof row !== 'object') return out;
  for (const key of Object.keys(row)) {
    const nk = String(key)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    let v = row[key];
    if (v != null && typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    out[nk] = v;
  }
  return out;
}

/**
 * Normalize one CSV row into comparable fields (best-effort for RevenueCat / store export headers).
 */
function parseComparableRow(norm) {
  const app_user_id =
    norm.app_user_id ||
    norm.appuserid ||
    norm.subscriber_attributes_app_user_id ||
    norm.customer_id ||
    norm.user_id ||
    null;

  /** Customer list CSV uses `all_purchased_product_ids` (singular "product"); other exports vary. */
  const fromPurchasedList = splitPurchasedProductIds(
    norm.all_purchased_product_ids ||
      norm.all_purchased_products_ids ||
      norm.purchased_product_ids ||
      norm.all_subscription_product_ids ||
      ''
  );

  const product_from_cols =
    norm.product_identifier ||
    norm.product_id ||
    norm.current_product_identifier ||
    norm.offer_identifier ||
    null;

  const product_trim = product_from_cols != null ? String(product_from_cols).trim() : '';

  /** Explicit CSV product first, then tokens from purchased-products list (order preserved). */
  const product_id_candidates = [];
  const pushCand = (v) => {
    const x = v != null ? String(v).trim() : '';
    if (!x || product_id_candidates.includes(x)) return;
    product_id_candidates.push(x);
  };
  if (product_trim) pushCand(product_trim);
  for (const x of fromPurchasedList) pushCand(x);

  const product_id = product_id_candidates[0] || null;

  /** Prefer original / family id (Apple original_transaction_id, Play purchase token, RC scheduled export names). */
  let provider_subscription_id =
    norm.original_store_transaction_id ||
    norm.original_transaction_id ||
    norm.original_transaction_id_android ||
    norm.original_transaction_identifier ||
    norm.latest_transaction_original_transaction_identifier ||
    norm.latest_original_transaction_identifier ||
    norm.latest_original_transaction_id ||
    norm.google_play_original_transaction_id ||
    norm.transaction_id_original ||
    norm.purchase_token ||
    norm.android_purchase_token ||
    norm.store_transaction_id ||
    norm.latest_store_transaction_id ||
    norm.latest_transaction_id ||
    norm.transaction_id ||
    norm.apple_order_id ||
    norm.order_id ||
    norm.latest_transaction_original_transaction_id ||
    norm.original_customer_id ||
    null;

  let expires_raw =
    norm.effective_end_date_ms ||
    norm.expiration_at ||
    norm.expiration_at_ms ||
    norm.expiration ||
    norm.expiration_at_utc ||
    norm.expires_date ||
    norm.end_time ||
    null;

  if (expires_raw != null && /^\d+$/.test(String(expires_raw).trim())) {
    const n = Number(String(expires_raw).trim());
    const ms = String(expires_raw).trim().length <= 10 ? n * 1000 : n;
    expires_raw = new Date(ms).toISOString();
  }

  let purchase_raw =
    norm.latest_purchase_at ||
    norm.purchased_at_ms ||
    norm.purchase_date_ms ||
    norm.original_purchase_date ||
    norm.recent_subscription_start_date ||
    norm.start_time_ms ||
    norm.start_time ||
    norm.purchase_date ||
    norm.purchased_date ||
    norm.first_seen_at_ms ||
    norm.first_seen_at ||
    norm.first_seen_at_utc ||
    null;

  if (purchase_raw != null && /^\d+$/.test(String(purchase_raw).trim())) {
    const n = Number(String(purchase_raw).trim());
    const ms = String(purchase_raw).trim().length <= 10 ? n * 1000 : n;
    purchase_raw = new Date(ms).toISOString();
  }

  const entitlement_status = norm.entitlement_status || norm.entitlement_state || norm.status || null;

  return {
    app_user_id: app_user_id != null ? String(app_user_id).trim() : null,
    product_id: product_id != null ? String(product_id).trim() : null,
    product_id_candidates,
    provider_subscription_id:
      provider_subscription_id != null ? String(provider_subscription_id).trim() : null,
    expires_date: expires_raw != null ? String(expires_raw).trim() : null,
    purchase_date: purchase_raw != null ? String(purchase_raw).trim() : null,
    entitlement_status: entitlement_status != null ? String(entitlement_status).trim() : null,
    _raw: norm
  };
}

function rcRowLooksActive(parsed) {
  const st = parsed.entitlement_status ? String(parsed.entitlement_status).toLowerCase() : '';
  if (st && /expir|revok|refund|cancel/.test(st) && !/grace|billing/.test(st)) return false;
  if (parsed.expires_date) {
    const d = new Date(parsed.expires_date);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now()) return false;
  }
  return true;
}

async function loadUsersExistence(userIds) {
  if (!userIds.length) return new Map();
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `SELECT user_id FROM user WHERE user_id IN (${placeholders}) AND DELETED_AT IS NULL`,
    userIds
  );
  const m = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    m.set(String(r.user_id), true);
  }
  return m;
}

async function loadSubscriptionsForPairs(pairs) {
  /** pairs: [{user_id, provider_plan_id}] */
  if (!pairs.length) return new Map();
  const key = (uid, pid) => `${uid}::${pid}`;
  const out = new Map();

  const userIds = [...new Set(pairs.map((p) => p.user_id))];
  if (!userIds.length) return out;

  const ph = userIds.map(() => '?').join(',');
  const subs = await MysqlQueryRunner.runQueryInSlave(
    `
    SELECT subscription_id, user_id, provider_plan_id, status, provider_subscription_id,
           start_at,
           current_period_end, renews_at, end_at, created_at, payment_type, provider
    FROM subscriptions
    WHERE provider = 'revenuecat'
      AND payment_type = 'recurring'
      AND user_id IN (${ph})
    ORDER BY created_at DESC
  `,
    userIds
  );

  /** @type {Map<string, object>} first (newest) sub per user+plan */
  for (const s of Array.isArray(subs) ? subs : []) {
    const k = key(s.user_id, s.provider_plan_id);
    if (!out.has(k)) out.set(k, s);
  }
  return out;
}

async function loadLatestRevenueCatOrderHints(userIds) {
  if (!userIds.length) return new Map();
  const ph = userIds.map(() => '?').join(',');
  const rows = await MysqlQueryRunner.runQueryInSlave(
    `
    SELECT user_id, MAX(order_id) AS order_id
    FROM orders
    WHERE payment_gateway = 'revenuecat' AND status = 'completed'
      AND user_id IN (${ph})
    GROUP BY user_id
  `,
    userIds
  );
  const m = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    m.set(String(r.user_id), r.order_id);
  }
  return m;
}

/** Product/SKU candidates from a parsed row (column + all_purchased_products_ids). */
function rowProductCandidates(p) {
  if (Array.isArray(p.product_id_candidates) && p.product_id_candidates.length) {
    return p.product_id_candidates;
  }
  return p.product_id ? [p.product_id] : [];
}

/**
 * Choose which SKU reconciles this row: prefer a recurring plan mapping, then an existing DB sub
 * for user+SKU, then any mapped plan.
 */
function pickResolvedProductForCompare(p, uid, subByPair, planByProduct) {
  const cands = rowProductCandidates(p);
  if (!cands.length) return { product_id: null, plan: null, sub: null };

  const subFor = (sku) =>
    uid && sku ? subByPair.get(pairKey(uid, String(sku).trim())) || null : null;

  for (const id of cands) {
    const sku = String(id).trim();
    if (!sku) continue;
    const plan = planByProduct.get(sku) || null;
    const bi = plan ? String(plan.billing_interval || '').toLowerCase() : '';
    if (plan && bi !== 'onetime') {
      return { product_id: sku, plan, sub: subFor(sku) };
    }
  }

  for (const id of cands) {
    const sku = String(id).trim();
    if (!sku) continue;
    const sub = subFor(sku);
    if (sub) {
      const plan = planByProduct.get(sku) || null;
      return { product_id: sku, plan, sub };
    }
  }

  for (const id of cands) {
    const sku = String(id).trim();
    if (!sku) continue;
    const plan = planByProduct.get(sku) || null;
    if (plan) {
      return { product_id: sku, plan, sub: subFor(sku) };
    }
  }

  const first = cands.map((c) => String(c).trim()).find(Boolean);
  return first
    ? { product_id: first, plan: null, sub: subFor(first) }
    : { product_id: null, plan: null, sub: null };
}

exports.compareRevenueCatCsv = async function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'CSV file is required (field name: file)' });
    }

    const text = req.file.buffer.toString('utf8');
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      delimiter: detectCsvDelimiter(text),
      transformHeader: (h) => String(h || '').trim()
    });

    if (parsed.errors && parsed.errors.length) {
      return res.status(400).json({
        message: 'Failed to parse CSV',
        errors: parsed.errors.slice(0, 8)
      });
    }

    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const comparable = [];
    for (const row of rows) {
      const norm = normalizeHeaders(row);
      const p = parseComparableRow(norm);
      if (!p.app_user_id && !p.product_id) continue;
      comparable.push(p);
    }

    const userIds = [...new Set(comparable.map((p) => p.app_user_id).filter(Boolean))];
    const userExists = await loadUsersExistence(userIds);

    const pairs = [];
    for (const p of comparable) {
      if (!p.app_user_id) continue;
      for (const planId of rowProductCandidates(p)) {
        pairs.push({ user_id: p.app_user_id, provider_plan_id: planId });
      }
    }
    const subByPair = await loadSubscriptionsForPairs(pairs);
    const orderHint = await loadLatestRevenueCatOrderHints(userIds);
    const allSkuForPlans = [];
    for (const p of comparable) {
      for (const id of rowProductCandidates(p)) {
        allSkuForPlans.push(id);
      }
    }
    const planByProduct = await ActivationService.bulkResolvePlansForRcProductIds(allSkuForPlans);

    const userDetailRows = userIds.length ? await GenerationsModel.getUsersByIds(userIds) : [];
    const userDetailsById = new Map();
    for (const u of Array.isArray(userDetailRows) ? userDetailRows : []) {
      userDetailsById.set(String(u.user_id), u);
    }

    let total = 0;
    let in_sync = 0;
    let missing = 0;
    let stale = 0;
    let cannot_activate = 0;
    const outRows = [];

    for (const p of comparable) {
      total += 1;
      const uid = p.app_user_id;
      const resolved = pickResolvedProductForCompare(p, uid, subByPair, planByProduct);
      const pid = resolved.product_id;

      let action_required = 'cannot_activate';
      let reason = '';
      let sub = resolved.sub || (uid && pid ? subByPair.get(pairKey(uid, pid)) || null : null);

      const fromCsvTx =
        p.provider_subscription_id != null && String(p.provider_subscription_id).trim() !== ''
          ? String(p.provider_subscription_id).trim()
          : '';
      const fromDbTx =
        sub && sub.provider_subscription_id != null && String(sub.provider_subscription_id).trim() !== ''
          ? String(sub.provider_subscription_id).trim()
          : '';
      /** Customer list CSV has no tx columns; reuse MySQL subscription id when row already exists. */
      const effectiveProviderSubId = fromCsvTx || fromDbTx || null;

      // Validation order: (1) user identity & existence → (2) product id → (3) idempotency + plan mapping → sync state
      if (!uid) {
        reason = 'Missing app user id in row';
      } else if (String(uid).startsWith('$RCAnonymousID')) {
        reason = 'anonymous RC id — no app user';
      } else if (!userExists.get(String(uid))) {
        reason = 'User not found in database';
      } else if (!pid) {
        reason =
          'Missing product id / SKU (set product_identifier or all_purchased_products_ids)';
      } else if (!effectiveProviderSubId) {
        reason =
          'Missing original / store transaction id. Customer list exports omit this field — use RevenueCat scheduled transaction export (e.g. original_store_transaction_id), or fix delimiter if the file is semicolon-separated.';
      } else {
        const plan =
          resolved.plan || (pid ? planByProduct.get(String(pid).trim()) || null : null);
        if (!plan) {
          const skuList = rowProductCandidates(p).filter(Boolean).join(', ') || String(pid);
          reason = `No internal payment plan mapped for SKU(s): ${skuList}`;
        } else if (String(plan.billing_interval || '').toLowerCase() === 'onetime') {
          reason = 'Plan maps to onetime billing — not a subscription tier';
        } else {
          const dbEntitled = ActivationService.recurringRowIsEntitled(sub);
          const rcActive = rcRowLooksActive(p);

          if (rcActive && dbEntitled) {
            action_required = 'none';
            in_sync += 1;
          } else if (rcActive && !dbEntitled) {
            action_required = 'activate';
            if (!sub) missing += 1;
            else stale += 1;
          } else {
            action_required = 'none';
            reason = 'RevenueCat row does not look active (expired or inactive status)';
            in_sync += 1;
          }
        }
      }

      if (action_required === 'cannot_activate') {
        cannot_activate += 1;
      }

      /** Resolved plan / DB provider_plan_id for display (SKU may come from all_purchased_products_ids). */
      const planRow =
        resolved.plan ||
        (pid && planByProduct.get(String(pid).trim())
          ? planByProduct.get(String(pid).trim())
          : null) ||
        (sub && sub.provider_plan_id != null && planByProduct.get(String(sub.provider_plan_id).trim())
          ? planByProduct.get(String(sub.provider_plan_id).trim())
          : null);

      outRows.push({
        app_user_id: uid,
        product_id: pid,
        provider_subscription_id: effectiveProviderSubId,
        rc_expires_date: p.expires_date,
        rc_purchase_date: p.purchase_date,
        db_purchase_date: sub ? sub.start_at : null,
        subscription_plan_name: planRow
          ? planRow.subscription_name
          : sub && sub.provider_plan_id
            ? String(sub.provider_plan_id)
            : null,
        rc_entitlement_status: p.entitlement_status,
        rc_active: rcRowLooksActive(p),
        user_exists: uid ? userExists.has(String(uid)) : false,
        user_details: uid ? userDetailsById.get(String(uid)) || null : null,
        db_subscription_id: sub ? sub.subscription_id : null,
        db_subscription_status: sub ? sub.status : null,
        db_period_end: sub ? sub.current_period_end || sub.renews_at || sub.end_at : null,
        db_provider_subscription_id: sub ? sub.provider_subscription_id : null,
        latest_revenuecat_order_id: uid ? orderHint.get(String(uid)) ?? null : null,
        action_required,
        reason: reason || null
      });
    }

    return res.status(200).json({
      data: {
        rows: outRows,
        summary: { total, in_sync, missing, stale, cannot_activate }
      }
    });
  } catch (err) {
    console.error('compareRevenueCatCsv error:', err && err.message ? err.message : err);
    return res.status(500).json({ message: err && err.message ? err.message : 'Compare failed' });
  }
};

exports.activateRevenueCatRow = async function (req, res) {
  try {
    const body = req.body || {};
    const user_id = body.user_id != null ? String(body.user_id).trim() : '';
    const product_id = body.product_id != null ? String(body.product_id).trim() : '';
    const provider_subscription_id =
      body.provider_subscription_id != null ? String(body.provider_subscription_id).trim() : '';
    const expires_date = body.expires_date;
    const include_credits = !!body.include_credits;
    const reason = body.reason;

    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const runId = body.run_id != null && String(body.run_id).trim() !== '' ? String(body.run_id).trim() : uuidv4();

    const result = await ActivationService.activateFromAdmin({
      user_id,
      product_id,
      provider_subscription_id,
      expires_date,
      include_credits,
      reason,
      granted_by_admin_id: String(req.user.userId),
      run_id: runId
    });

    return res.status(200).json({ data: result });
  } catch (err) {
    const code = err && err.httpStatusCode ? err.httpStatusCode : 500;
    if (code >= 500) console.error('activateRevenueCatRow error:', err && err.message ? err.message : err);
    return res.status(code).json({
      message: err && err.message ? err.message : 'Activation failed',
      code: err && err.code ? err.code : undefined
    });
  }
};
