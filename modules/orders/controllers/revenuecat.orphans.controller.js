'use strict';

const Papa = require('papaparse');
const multer = require('multer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const ActivationService = require('../services/revenuecat-activation.service');
const GenerationsModel = require('../../generations/models/generations.model');
const SubscriptionsAnalyticsModel = require('../../analytics/models/subscriptions.analytics.model');

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

exports.multerCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, _file, cb) => cb(null, true)
}).single('file');

/**
 * Customer list CSV exports omit store / original transaction IDs. When there is no matching MySQL
 * `subscriptions.provider_subscription_id`, we still need a stable unique value for admin activation
 * idempotency within this user+SKU pair (not a real App Store / Play token).
 */
function deterministicSyntheticProviderSubscriptionId(userId, productSku) {
  const h = crypto
    .createHash('sha256')
    .update(`rc_customer_list|${String(userId).trim()}|${String(productSku).trim()}`, 'utf8')
    .digest('hex');
  return `rc_clist_${h.slice(0, 48)}`;
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

/**
 * Play / RC product ids: keep the full token and each `:` segment (DB often stores the
 * composite `base:offer` while CSV columns also expose the parts separately).
 */
function collectProductSkuTokens(raw) {
  const x = raw != null ? String(raw).trim() : '';
  if (!x) return [];
  const out = [x];
  if (x.includes(':')) {
    for (const part of x.split(':')) {
      const p = part.trim();
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** @deprecated alias — same as {@link collectProductSkuTokens} */
function expandProductIdTokens(raw) {
  return collectProductSkuTokens(raw);
}

function productSkuTokensEquivalent(a, b) {
  const aa = collectProductSkuTokens(a);
  const bb = collectProductSkuTokens(b);
  for (const x of aa) {
    if (bb.includes(x)) return true;
  }
  return false;
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
    norm.latest_product ||
    norm.latest_entitlement ||
    norm.latest_entitlements ||
    norm.offer_identifier ||
    null;

  /** Explicit CSV product first, then tokens from purchased-products list (order preserved). */
  const product_id_candidates = [];
  const pushCand = (v) => {
    for (const x of expandProductIdTokens(v)) {
      if (!x || product_id_candidates.includes(x)) continue;
      product_id_candidates.push(x);
    }
  };
  if (product_from_cols != null) pushCand(product_from_cols);
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
    norm.latest_expiration_at ||
    norm.expiration_at ||
    norm.expiration_at_ms ||
    norm.expiration ||
    norm.expiration_at_utc ||
    norm.expires_date ||
    norm.trial_end_at ||
    norm.end_time ||
    null;

  if (expires_raw != null && /^\d+$/.test(String(expires_raw).trim())) {
    const n = Number(String(expires_raw).trim());
    const ms = String(expires_raw).trim().length <= 10 ? n * 1000 : n;
    expires_raw = new Date(ms).toISOString();
  }

  let purchase_raw =
    norm.most_recent_purchase_at ||
    norm.most_recent_renewal_at ||
    norm.first_purchase_at ||
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

/**
 * All recurring subs per user (any store provider) — matches api subscription.model fetchActiveSubscriptions.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, object[]>>}
 */
async function loadRecurringSubscriptionsByUser(userIds, useMaster = false) {
  const out = new Map();
  if (!userIds.length) return out;

  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
  const ph = userIds.map(() => '?').join(',');
  const subs = await runQuery(
    `
    SELECT subscription_id, user_id, provider_plan_id, status, provider_subscription_id,
           start_at,
           current_period_end, renews_at, end_at, created_at, payment_type, provider
    FROM subscriptions
    WHERE payment_type = 'recurring'
      AND user_id IN (${ph})
    ORDER BY COALESCE(start_at, created_at) DESC, created_at DESC, subscription_id DESC
  `,
    userIds
  );

  for (const s of Array.isArray(subs) ? subs : []) {
    const uid = String(s.user_id);
    if (!out.has(uid)) out.set(uid, []);
    out.get(uid).push(s);
  }
  return out;
}

function normalizePlanSku(raw) {
  return raw != null ? String(raw).trim() : '';
}

/** RevenueCat orphan CSV reconciles subscriptions created/managed via RevenueCat — not legacy direct store rows that share the same plan SKU. */
function subscriptionRowIsRevenueCatManaged(sub) {
  const p = sub && sub.provider != null ? String(sub.provider).trim().toLowerCase() : '';
  return p === 'revenuecat';
}

/**
 * DB row matches CSV product / resolved payment_plans.pp_id (SKU string or numeric pp_id).
 */
function subscriptionMatchesResolvedPlan(sub, targetPpId, skuCandidates, planByProduct) {
  const pid = normalizePlanSku(sub.provider_plan_id);
  if (!pid) return false;

  const cands = [...new Set((skuCandidates || []).map(normalizePlanSku).filter(Boolean))];
  if (cands.includes(pid)) return true;
  if (cands.some((c) => productSkuTokensEquivalent(c, pid))) return true;

  if (targetPpId != null && /^\d+$/.test(pid) && String(targetPpId) === pid) return true;

  const dbPlanMeta = planByProduct.get(pid) || null;
  if (targetPpId != null && dbPlanMeta && String(dbPlanMeta.subscription_plan_id) === String(targetPpId)) {
    return true;
  }

  for (const sku of cands) {
    const csvPlan = planByProduct.get(sku) || null;
    if (!csvPlan || !dbPlanMeta) continue;
    if (String(csvPlan.subscription_plan_id) === String(dbPlanMeta.subscription_plan_id)) return true;
  }
  return false;
}

/**
 * Newest-first recurring rows for this user that map to the CSV plan (any IAP provider).
 */
function findSubscriptionsForCompareRow(uid, skuCandidates, targetPpId, planByProduct, subsByUser) {
  const subs = subsByUser.get(String(uid)) || [];
  return subs.filter((s) => {
    if (subscriptionMatchesResolvedPlan(s, targetPpId, skuCandidates, planByProduct)) return true;
    if (targetPpId == null) return false;
    const pid = normalizePlanSku(s.provider_plan_id);
    if (!pid) return false;
    const meta = planByProduct.get(pid) || null;
    return meta && String(meta.subscription_plan_id) === String(targetPpId);
  });
}

/**
 * Among plan-matched recurring rows (newest `start_at` first), only the latest row decides
 * Active vs Activate — same idea as Customers active-snapshot / latest-sub views, not an older
 * entitled row for the same plan.
 */
function pickCompareSubscription(matchingSubs) {
  const latest = matchingSubs.length ? matchingSubs[0] : null;
  const entitledSub =
    latest && ActivationService.recurringRowIsEntitled(latest) ? latest : null;
  return { latest, entitledSub, displaySub: latest };
}

/**
 * Newest entitled recurring row for this CSV tier that is RevenueCat-managed (admin activation target).
 */
function findEntitledRevenueCatSubForCompareRow(uid, skuCandidates, targetPpId, planByProduct, subsByUser) {
  const subs = subsByUser.get(String(uid)) || [];
  for (const s of subs) {
    if (!subscriptionRowIsRevenueCatManaged(s)) continue;
    if (!subscriptionMatchesResolvedPlan(s, targetPpId, skuCandidates, planByProduct)) continue;
    if (!ActivationService.recurringRowIsEntitled(s)) continue;
    return s;
  }
  return null;
}

/**
 * Resolve `subscriptions.provider_plan_id` to canonical `payment_plans.pp_id` string.
 */
function resolveProviderPlanIdToPpId(providerPlanRaw, planByProduct) {
  if (providerPlanRaw == null) return null;
  for (const tok of collectProductSkuTokens(providerPlanRaw)) {
    const m = planByProduct.get(tok) || null;
    if (m && m.subscription_plan_id != null) return String(m.subscription_plan_id);
  }
  const p = normalizePlanSku(providerPlanRaw);
  if (p && /^\d+$/.test(p)) return p;
  return null;
}

/**
 * First payment_plans row mapped from a DB subscription `provider_plan_id` (composite SKUs, numeric pp_id).
 */
function resolvePaymentPlanMetaForDbSub(providerPlanRaw, planByProduct) {
  if (providerPlanRaw == null) return null;
  for (const tok of collectProductSkuTokens(providerPlanRaw)) {
    const m = planByProduct.get(tok) || null;
    if (m) return m;
  }
  const p = normalizePlanSku(providerPlanRaw);
  if (p && /^\d+$/.test(p)) {
    const m = planByProduct.get(p) || null;
    if (m) return m;
  }
  return null;
}

/**
 * `subscription_id` values with both SCH and at least one completed `credits_transactions` row
 * (what the admin user profile Credits tab lists). SCH alone is not enough — avoids
 * "Credits already issued" when the ledger is empty.
 *
 * @param {string[]} userIds
 * @returns {Promise<Set<string>>}
 */
async function loadSubscriptionIdsWithCreditsLedger(userIds, useMaster = false) {
  const out = new Set();
  const ids = [...new Set((userIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  if (!ids.length) return out;

  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
  const ph = ids.map(() => '?').join(',');
  const rows = await runQuery(
    `
    SELECT DISTINCT sch.subscription_id
    FROM subscription_credit_history sch
    INNER JOIN subscriptions s
      ON s.subscription_id COLLATE utf8mb4_unicode_ci = sch.subscription_id COLLATE utf8mb4_unicode_ci
      AND TRIM(COALESCE(s.payment_type, '')) = 'recurring'
    INNER JOIN credits_transactions ct
      ON ct.user_id COLLATE utf8mb4_unicode_ci = sch.user_id COLLATE utf8mb4_unicode_ci
      AND ct.reference_id COLLATE utf8mb4_unicode_ci = sch.subscription_id COLLATE utf8mb4_unicode_ci
      AND ct.status = 'completed'
      AND ct.transaction_type IN ('subscription_initial', 'subscription_upgrade')
      AND ct.reference_type IN ('subscription_credits', 'bonus_credits')
    WHERE sch.user_id COLLATE utf8mb4_unicode_ci IN (${ph})
    `,
    ids
  );

  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.subscription_id != null) out.add(String(r.subscription_id));
  }
  return out;
}

/**
 * Credits already issued when the matched DB subscription has SCH + ledger rows (admin profile).
 *
 * @param {string|null|undefined} dbSubscriptionId subscriptions.subscription_id for refresh path
 * @param {Set<string>} subscriptionIdsWithCreditsLedger
 * @returns {boolean}
 */
function creditsAlreadyIssuedForCompareRow(dbSubscriptionId, subscriptionIdsWithCreditsLedger) {
  if (dbSubscriptionId == null || String(dbSubscriptionId).trim() === '') return false;
  return subscriptionIdsWithCreditsLedger.has(String(dbSubscriptionId));
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
/** Resolve CSV SKU + internal plan row (no DB sub — matching is plan-aware below). */
function pickResolvedProductForCompare(p, planByProduct) {
  const cands = rowProductCandidates(p);
  if (!cands.length) return { product_id: null, plan: null };

  for (const id of cands) {
    const sku = String(id).trim();
    if (!sku) continue;
    const plan = planByProduct.get(sku) || null;
    const bi = plan ? String(plan.billing_interval || '').toLowerCase() : '';
    if (plan && bi !== 'onetime') {
      return { product_id: sku, plan };
    }
  }

  for (const id of cands) {
    const sku = String(id).trim();
    if (!sku) continue;
    const plan = planByProduct.get(sku) || null;
    if (plan) {
      return { product_id: sku, plan };
    }
  }

  const first = cands.map((c) => String(c).trim()).find(Boolean);
  return first ? { product_id: first, plan: planByProduct.get(first) || null } : { product_id: null, plan: null };
}

exports.compareRevenueCatCsv = async function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'CSV file is required (field name: file)' });
    }

    const freshRead =
      req.query &&
      (req.query.fresh === '1' ||
        req.query.fresh === 'true' ||
        String(req.query.fresh || '').toLowerCase() === 'yes');

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

    const subsByUser = await loadRecurringSubscriptionsByUser(userIds, freshRead);
    const orderHint = await loadLatestRevenueCatOrderHints(userIds);
    const allSkuForPlans = [];
    for (const p of comparable) {
      for (const id of rowProductCandidates(p)) {
        allSkuForPlans.push(id);
      }
    }
    for (const subs of subsByUser.values()) {
      for (const s of subs) {
        if (s.provider_plan_id != null) {
          for (const tok of collectProductSkuTokens(s.provider_plan_id)) {
            allSkuForPlans.push(tok);
          }
        }
      }
    }
    const planByProduct = await ActivationService.bulkResolvePlansForRcProductIds(allSkuForPlans);

    const subscriptionIdsWithCreditsLedger = await loadSubscriptionIdsWithCreditsLedger(
      userIds,
      freshRead
    );

    /** Same snapshot as Customers → Active subscriptions (latest recurring row per user, entitled now). Uses DB UTC_TIMESTAMP. */
    const entitledSnapshotByUser = await SubscriptionsAnalyticsModel.loadEntitledSnapshotSubsByUserIds(
      userIds,
      { useMaster: freshRead }
    );

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
      const skuCandidates = rowProductCandidates(p);
      const resolved = pickResolvedProductForCompare(p, planByProduct);
      const pid = resolved.product_id;

      let action_required = 'cannot_activate';
      let reason = '';
      const planRow =
        resolved.plan || (pid ? planByProduct.get(String(pid).trim()) || null : null);
      const targetPpId =
        planRow && planRow.subscription_plan_id != null ? planRow.subscription_plan_id : null;
      const matchingSubs =
        uid && pid
          ? findSubscriptionsForCompareRow(uid, skuCandidates, targetPpId, planByProduct, subsByUser)
          : [];
      const { displaySub } = pickCompareSubscription(matchingSubs);
      const snapshotSub = uid ? entitledSnapshotByUser.get(String(uid)) || null : null;
      const entitledRcSub =
        uid && pid
          ? findEntitledRevenueCatSubForCompareRow(
              uid,
              skuCandidates,
              targetPpId,
              planByProduct,
              subsByUser
            )
          : null;
      const snapshotMatchesCsv =
        snapshotSub != null &&
        subscriptionRowIsRevenueCatManaged(snapshotSub) &&
        subscriptionMatchesResolvedPlan(snapshotSub, targetPpId, skuCandidates, planByProduct);
      const rcRowInSync = snapshotMatchesCsv || entitledRcSub != null;
      const snapshotWrongProviderForRc =
        snapshotSub != null &&
        subscriptionMatchesResolvedPlan(snapshotSub, targetPpId, skuCandidates, planByProduct) &&
        !subscriptionRowIsRevenueCatManaged(snapshotSub);
      let sub = displaySub;

      const fromCsvTx =
        p.provider_subscription_id != null && String(p.provider_subscription_id).trim() !== ''
          ? String(p.provider_subscription_id).trim()
          : '';
      const fromDbTx =
        sub && sub.provider_subscription_id != null && String(sub.provider_subscription_id).trim() !== ''
          ? String(sub.provider_subscription_id).trim()
          : '';
      /** CSV + DB may lack tx id (RevenueCat customer list); then use stable synthetic for admin idempotency. */
      let effectiveProviderSubId = fromCsvTx || fromDbTx || null;
      let providerSubscriptionIdSynthetic = false;
      if (
        !effectiveProviderSubId &&
        uid &&
        pid &&
        !String(uid).startsWith('$RCAnonymousID')
      ) {
        effectiveProviderSubId = deterministicSyntheticProviderSubscriptionId(uid, pid);
        providerSubscriptionIdSynthetic = true;
      }

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
      } else {
        if (!planRow) {
          const skuList = skuCandidates.filter(Boolean).join(', ') || String(pid);
          reason = `No internal payment plan mapped for SKU(s): ${skuList}`;
        } else if (String(planRow.billing_interval || '').toLowerCase() === 'onetime') {
          reason = 'Plan maps to onetime billing — not a subscription tier';
        } else {
          /**
           * RC row is in sync when any entitled RevenueCat-managed row matches this CSV tier, or the global
           * entitled snapshot is RevenueCat for the same tier — not e.g. native Play rows that reuse the SKU.
           */
          if (rcRowInSync) {
            action_required = 'none';
            in_sync += 1;
            sub = entitledRcSub || snapshotSub;
          } else {
            action_required = 'activate';
            if (!matchingSubs.length) {
              missing += 1;
              reason = snapshotSub
                ? 'No DB row for this CSV plan (user active on a different subscription)'
                : 'No matching DB subscription; user not in current active subscriptions';
            } else {
              stale += 1;
              reason = snapshotWrongProviderForRc
                ? `Entitled recurring row matches this plan but subscriptions.provider is not revenuecat (got '${snapshotSub.provider != null ? String(snapshotSub.provider).trim() : ''}' ) — reconcile RevenueCat-managed subscription`
                : !snapshotSub
                  ? 'User not in current active subscriptions (latest recurring row expired or missing)'
                  : 'Latest DB row for this plan is expired; user active on a different subscription';
            }
          }
        }
      }

      if (action_required === 'cannot_activate') {
        cannot_activate += 1;
      }

      /**
       * Credits flag is per subscription row. Play/App store initial credits must not block
       * "With credits" when reconciling a RevenueCat CSV row (different provider).
       */
      let creditSubIdForRow = null;
      if (sub && sub.subscription_id != null) {
        if (subscriptionRowIsRevenueCatManaged(sub)) {
          creditSubIdForRow = String(sub.subscription_id);
        } else if (entitledRcSub && entitledRcSub.subscription_id != null) {
          creditSubIdForRow = String(entitledRcSub.subscription_id);
        } else {
          creditSubIdForRow = null;
        }
      }
      const credits_already_issued = creditsAlreadyIssuedForCompareRow(
        creditSubIdForRow,
        subscriptionIdsWithCreditsLedger
      );

      const snapshotPlanMeta =
        snapshotSub != null
          ? resolvePaymentPlanMetaForDbSub(snapshotSub.provider_plan_id, planByProduct)
          : null;
      /** Table column: prefer Customers-style latest entitled plan; else CSV-resolved plan; else matched row SKU. */
      const planRowForDisplay =
        snapshotPlanMeta ||
        planRow ||
        (sub != null ? resolvePaymentPlanMetaForDbSub(sub.provider_plan_id, planByProduct) : null);
      /** Credits / activation idempotency follow the CSV row's resolved tier — keep explicit for tooltips. */
      const csvPlanName =
        planRow && planRow.subscription_name != null ? String(planRow.subscription_name) : null;

      outRows.push({
        app_user_id: uid,
        product_id: pid,
        provider_subscription_id: effectiveProviderSubId,
        provider_subscription_id_synthetic: providerSubscriptionIdSynthetic,
        rc_expires_date: p.expires_date,
        rc_purchase_date: p.purchase_date,
        db_purchase_date: sub ? sub.start_at : null,
        subscription_plan_name: planRowForDisplay
          ? planRowForDisplay.subscription_name
          : sub && sub.provider_plan_id
            ? String(sub.provider_plan_id)
            : null,
        csv_subscription_plan_name: csvPlanName,
        rc_entitlement_status: p.entitlement_status,
        rc_active: true,
        user_exists: uid ? userExists.has(String(uid)) : false,
        user_details: uid ? userDetailsById.get(String(uid)) || null : null,
        db_subscription_id: sub ? sub.subscription_id : null,
        db_subscription_status: sub ? sub.status : null,
        db_period_end: sub ? sub.current_period_end || sub.renews_at || sub.end_at : null,
        db_provider_subscription_id: sub ? sub.provider_subscription_id : null,
        latest_revenuecat_order_id: uid ? orderHint.get(String(uid)) ?? null : null,
        action_required,
        reason: reason || null,
        credits_already_issued,
        recommended_include_credits: !credits_already_issued,
        db_snapshot_subscription_id:
          snapshotSub && snapshotSub.subscription_id != null ? String(snapshotSub.subscription_id) : null,
        db_snapshot_provider: snapshotSub && snapshotSub.provider != null ? String(snapshotSub.provider) : null,
        db_snapshot_period_end:
          snapshotSub &&
          (snapshotSub.current_period_end || snapshotSub.renews_at || snapshotSub.end_at)
            ? snapshotSub.current_period_end || snapshotSub.renews_at || snapshotSub.end_at
            : null,
        db_snapshot_provider_plan_id:
          snapshotSub && snapshotSub.provider_plan_id != null ? String(snapshotSub.provider_plan_id) : null
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
    const purchase_date = body.purchase_date;
    const existing_subscription_id =
      body.existing_subscription_id != null ? String(body.existing_subscription_id).trim() : '';
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
      purchase_date,
      existing_subscription_id: existing_subscription_id || undefined,
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
