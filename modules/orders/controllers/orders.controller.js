'use strict';

const OrdersModel = require('../models/orders.model');
const PaymentOrphanModel = require('../models/payment-orphan.model');
const PaymentPlansModel = require('../../payment-plans/models/payment-plans.model');
const GenerationsModel = require('../../generations/models/generations.model');
const { formatGuestDeviceDisplayName } = require('../utils/guestDeviceDisplay.util');
const { stitchGuestDeviceDetailsForRows } = require('../utils/guestDeviceStitch.util');
const orderTemplateStitch = require('../utils/orderTemplateStitch.util');
const orderLifecycleAnalyticsEnrichment = require('../utils/ordersLifecycleAnalyticsEnrichment.util');
const GooglePlayOrderSyncService = require('../services/google-play-order-sync.service');
const AppleOrphanDecoder = require('../services/apple-orphan-decoder.service');
const { purchaseCategoryFromOrder } = require('../utils/purchaseCategory.util');

const MAX_EXPORT_ROWS = 25000;
/** Skip ClickHouse enrichment on CSV export above this many rows (single IN clause). */
const MAX_ORDERS_ANALYTICS_ENRICH = 2000;

function mapRowToAdminOrder(o, planById, userById, templateNameById, packNameById) {
  const plan = o.payment_plan_id != null ? planById[o.payment_plan_id] : null;
  const planType = plan ? plan.plan_type : null;
  const billingInterval = plan ? plan.billing_interval : null;
  const templateId = orderTemplateStitch.parseTemplateIdFromTransactionNotes(o.transaction_notes);
  const templateName =
    templateId && templateNameById && Object.prototype.hasOwnProperty.call(templateNameById, templateId)
      ? templateNameById[templateId]
      : null;
  const packId = orderTemplateStitch.parsePackIdFromTransactionNotes(o.transaction_notes);
  const packName =
    packId && packNameById && Object.prototype.hasOwnProperty.call(packNameById, packId)
      ? packNameById[packId]
      : null;
  return {
    order_id: o.order_id,
    user_id: o.user_id,
    device_id: o.device_id ?? null,
    is_guest_unclaimed: !o.user_id && !!o.device_id,
    is_guest_device: !o.user_id && !!o.device_id,
    guest_display_name:
      !o.user_id && o.device_id ? formatGuestDeviceDisplayName(o.device_id) : null,
    guest_device_details: null,
    payment_gateway: o.payment_gateway,
    client_platform: o.client_platform ?? null,
    pg_order_id: o.pg_order_id,
    quantity: o.quantity,
    pg_payment_id: o.pg_payment_id,
    payment_plan_id: o.payment_plan_id,
    amount_paid: o.amount_paid,
    currency: o.currency,
    payment_method: o.payment_method,
    status: o.status,
    created_at: o.created_at,
    completed_at: o.completed_at,
    failed_at: o.failed_at,
    refunded_at: o.refunded_at,
    plan_type: planType ?? null,
    plan_name: plan ? plan.plan_name ?? null : null,
    plan_heading: plan ? plan.plan_heading ?? null : null,
    billing_interval: billingInterval ?? null,
    purchase_category: purchaseCategoryFromOrder(o, plan),
    user_details: userById[o.user_id] || null,
    template_id: templateId,
    template_name: templateName,
    pack_id: packId,
    pack_name: packName,
    analytics_app_version: null,
    analytics_os_name: null,
    analytics_os_version: null
  };
}

async function stitchPlansAndUsersForRows(rows) {
  const planIds = [...new Set(rows.map((r) => r.payment_plan_id).filter((id) => id != null))];
  const planRows = planIds.length ? await PaymentPlansModel.getPlansByIds(planIds) : [];
  const planById = {};
  for (const p of planRows) {
    planById[p.pp_id] = p;
  }

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const users = userIds.length ? await GenerationsModel.getUsersByIds(userIds) : [];
  const userById = {};
  for (const u of users) {
    userById[u.user_id] = u;
  }
  return { planById, userById };
}

function csvEscape(value) {
  if (value == null || value === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatCsvDate(v) {
  if (v == null || v === '') return '';
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString();
  } catch {
    return String(v);
  }
}

/**
 * One row per distinct user_id, sorted by user_id ascending, with a stable row_num (#) for review in Excel.
 * Built from the same capped order list as the per-order export (newest orders first in DB; aggregation loses that order).
 */
function aggregateOrdersByUserForCsv(orders) {
  /** @type {Map<string, { userKey: string, userRows: object[] }>} */
  const map = new Map();
  for (const o of orders) {
    const uid = o.user_id;
    const did = o.device_id;
    const key =
      uid != null && uid !== ''
        ? String(uid)
        : did != null && did !== ''
          ? `device:${String(did)}`
          : '__NO_USER__';
    let agg = map.get(key);
    if (!agg) {
      agg = { userKey: key, userRows: [] };
      map.set(key, agg);
    }
    agg.userRows.push(o);
  }

  const rows = [];
  for (const { userKey, userRows } of map.values()) {
    const orderIds = [
      ...new Set(userRows.map((r) => r.order_id).filter((id) => id != null && id !== ''))
    ].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });

    const times = userRows
      .map((r) => r.created_at)
      .filter(Boolean)
      .map((d) => {
        try {
          return new Date(d).getTime();
        } catch {
          return NaN;
        }
      })
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);

    const newestFirst = [...userRows].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    const u =
      newestFirst.find((r) => r.user_details && Object.keys(r.user_details).length)?.user_details ||
      newestFirst[0]?.user_details ||
      {};

    rows.push({
      row_num: 0,
      user_id: userKey === '__NO_USER__' ? '' : userKey,
      order_count: orderIds.length,
      display_name: u.display_name ?? '',
      email: u.email ?? '',
      mobile: u.mobile ?? '',
      first_order_at: times.length ? new Date(times[0]).toISOString() : '',
      last_order_at: times.length ? new Date(times[times.length - 1]).toISOString() : '',
      order_ids: orderIds.join('; ')
    });
  }

  rows.sort((a, b) => {
    const ua = a.user_id;
    const ub = b.user_id;
    if (!ua && !ub) return 0;
    if (!ua) return 1;
    if (!ub) return -1;
    return ua.localeCompare(ub);
  });
  rows.forEach((r, i) => {
    r.row_num = i + 1;
  });
  return rows;
}

const moment = require('moment');
const TimezoneService = require('../../analytics/services/timezone.service');

/**
 * Optional created-at range (client calendar → UTC) or numeric order_id bounds from query string.
 * When both are present, created-at range wins and order_id bounds are ignored (matches admin UI XOR).
 * Mutates filterPayload with createdAtFrom, createdAtTo, orderIdFrom, orderIdTo when valid.
 * @returns {{ status: number, message: string } | null} error response body or null
 */
function mergeAdminOrdersRangeFiltersFromQuery(req, filterPayload) {
  const start_date = req.query.start_date != null ? String(req.query.start_date).trim() : '';
  const end_date = req.query.end_date != null ? String(req.query.end_date).trim() : '';
  const tz = req.query.tz != null ? String(req.query.tz).trim() : '';
  let hasCreatedRange = false;
  if (start_date || end_date) {
    if (!start_date || !end_date) {
      return { status: 400, message: 'Both start_date and end_date are required for a date filter.' };
    }
    const timezone = tz || TimezoneService.getDefaultTimezone();
    if (!TimezoneService.isValidTimezone(timezone)) {
      return { status: 400, message: 'Invalid timezone' };
    }
    const utcFilters = TimezoneService.convertToUTC(start_date, end_date, null, null, timezone);
    const createdAtFrom = moment.utc(`${utcFilters.start_date} ${utcFilters.start_time}`).format('YYYY-MM-DD HH:mm:ss');
    const createdAtTo = moment.utc(`${utcFilters.end_date} ${utcFilters.end_time}`).format('YYYY-MM-DD HH:mm:ss');
    if (moment.utc(createdAtFrom).isAfter(moment.utc(createdAtTo))) {
      return { status: 400, message: 'Start date cannot be after end date.' };
    }
    filterPayload.createdAtFrom = createdAtFrom;
    filterPayload.createdAtTo = createdAtTo;
    hasCreatedRange = true;
  }

  function parseOrderIdParam(v) {
    if (v == null || v === '') return null;
    const n = parseInt(String(v).trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 2147483647) return null;
    return n;
  }

  // Same rule as admin UI: created range XOR order id range (avoid stricter AND if both appear in query).
  if (!hasCreatedRange) {
    const orderIdFrom = parseOrderIdParam(req.query.order_id_from);
    const orderIdTo = parseOrderIdParam(req.query.order_id_to);
    let orderIdFromFinal = orderIdFrom;
    let orderIdToFinal = orderIdTo;
    if (orderIdFrom != null && orderIdTo != null && orderIdFrom > orderIdTo) {
      orderIdFromFinal = orderIdTo;
      orderIdToFinal = orderIdFrom;
    }
    if (orderIdFromFinal != null) {
      filterPayload.orderIdFrom = orderIdFromFinal;
    }
    if (orderIdToFinal != null) {
      filterPayload.orderIdTo = orderIdToFinal;
    }
  }

  return null;
}

/**
 * GET /admin/orders — paginated orders for admin (filters + search).
 */
exports.listAdminOrders = async function (req, res) {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const pageRaw = parseInt(req.query.page, 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20, 100);
    const page = Math.max(Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1, 1);
    const offset = (page - 1) * limit;

    const status = req.query.status ? String(req.query.status).trim() : '';
    const productType = req.query.product_type ? String(req.query.product_type).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const client_platform = req.query.client_platform ? String(req.query.client_platform).trim().toLowerCase() : '';

    const filterPayload = { status, productType, search, client_platform };

    const rangeErr = mergeAdminOrdersRangeFiltersFromQuery(req, filterPayload);
    if (rangeErr) {
      return res.status(rangeErr.status).json({ message: rangeErr.message });
    }

    const preparedFilters = await OrdersModel.prepareAdminOrdersFilters(filterPayload);

    const tzRaw = req.query.tz != null ? String(req.query.tz).trim() : '';
    const summaryTz =
      tzRaw && TimezoneService.isValidTimezone(tzRaw)
        ? tzRaw
        : TimezoneService.getDefaultTimezone();

    const [total, rows, distinctUsersResult] = await Promise.all([
      OrdersModel.countOrdersAdmin(preparedFilters),
      OrdersModel.listOrdersAdmin({ ...preparedFilters, limit, offset }),
      page === 1 ? OrdersModel.countDistinctUsersAdmin(preparedFilters) : Promise.resolve(null)
    ]);

    /** Local calendar days represented on this page (usually 1–5); stats run only for these UTC day windows. */
    const dayKeySet = new Set();
    for (const r of rows || []) {
      const k = OrdersModel.calendarDayKeyFromCreatedAt(r.created_at, summaryTz);
      if (k) dayKeySet.add(k);
    }
    const dayKeys = [...dayKeySet].sort((a, b) => b.localeCompare(a));

    let summary;
    if (dayKeys.length > 0) {
      const dayAgg = await OrdersModel.summarizeAdminOrdersForCalendarDays(
        preparedFilters,
        summaryTz,
        dayKeys
      );
      if (page === 1) {
        summary = {
          unique_users: distinctUsersResult,
          distinct_calendar_days: dayAgg.distinct_calendar_days,
          orders_by_calendar_day: dayAgg.orders_by_calendar_day
        };
      } else {
        summary = {
          orders_by_calendar_day: dayAgg.orders_by_calendar_day,
          distinct_calendar_days: dayAgg.distinct_calendar_days
        };
      }
    } else if (page === 1) {
      summary = {
        unique_users: distinctUsersResult,
        distinct_calendar_days: 0,
        orders_by_calendar_day: []
      };
    }

    const { planById, userById } = await stitchPlansAndUsersForRows(rows);
    const guestDeviceById = await stitchGuestDeviceDetailsForRows(rows);
    const [templateNameById, packNameById] = await Promise.all([
      orderTemplateStitch.buildTemplateNameByIdMap(rows),
      orderTemplateStitch.buildPackNameByIdMap(rows)
    ]);
    const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(rows);
    const orders = rows.map((o) => {
      const base = mapRowToAdminOrder(o, planById, userById, templateNameById, packNameById);
      if (!base.user_id && base.device_id) {
        base.guest_device_details = guestDeviceById.get(String(base.device_id)) || null;
      }
      return orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(base, ctxMap);
    });

    const payload = {
      orders,
      page,
      limit,
      total,
      has_more: offset + orders.length < total
    };
    if (summary) {
      payload.summary = summary;
    }

    return res.status(200).json({
      data: payload
    });
  } catch (err) {
    console.error('listAdminOrders error:', err);
    return res.status(500).json({
      message: 'Failed to list orders'
    });
  }
};

/**
 * Common orphan row → display dictionary. Whichever gateway we are listing, the admin UI gets the same shape.
 */
function _baseOrphanMeta(orph) {
  return {
    id: orph.id,
    gateway: orph.gateway,
    purchase_token: orph.purchase_token,
    source: orph.source,
    reason_code: orph.reason_code,
    user_id_hint: orph.user_id_hint,
    requested_internal_order_id: orph.requested_internal_order_id,
    notification_type: orph.notification_type,
    product_id: orph.product_id,
    app_version: orph.app_version,
    device_os: orph.device_os,
    device_os_version: orph.device_os_version,
    device_brand: orph.device_brand,
    device_model: orph.device_model,
    first_seen_at: orph.first_seen_at,
    last_seen_at: orph.last_seen_at,
    payload_json: orph.payload_json
  };
}

/**
 * Build the Google-Play-specific orphan view (calls Google to enrich, links to internal orders by pg_order_id / pg_payment_id).
 */
async function _buildGooglePlayOrphanView({ orphanRows }) {
  const pgIds = orphanRows
    .map((r) => r.play_order_id)
    .filter((id) => id != null && String(id).trim() !== '')
    .map((id) => String(id).trim());

  let playMeta = { ordersById: {}, failures: [], skipped: false };
  try {
    playMeta = await GooglePlayOrderSyncService.batchGetOrdersByPlayOrderIds(pgIds);
  } catch (e) {
    if (e && e.code === 'GOOGLE_NOT_CONFIGURED') {
      playMeta = { ordersById: {}, failures: [], skipped: true };
    } else {
      console.error('listAdminOrphanedOrders[google_play]: Play batch lookup failed', e.message || e);
      playMeta = { ordersById: {}, failures: [], skipped: true };
    }
  }

  const matchRows = await OrdersModel.findGooglePlayOrdersMatchingOrphans({
    pgOrderIds: orphanRows.map((r) => r.play_order_id),
    purchaseTokens: orphanRows.map((r) => r.purchase_token)
  });

  const { planById, userById } = await stitchPlansAndUsersForRows(matchRows);
  const [templateNameById, packNameById] = await Promise.all([
    orderTemplateStitch.buildTemplateNameByIdMap(matchRows),
    orderTemplateStitch.buildPackNameByIdMap(matchRows)
  ]);
  const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(matchRows);

  const byPg = Object.create(null);
  const byTok = Object.create(null);
  for (const r of matchRows) {
    if (r.pg_order_id != null && String(r.pg_order_id).trim() !== '') {
      byPg[String(r.pg_order_id).trim()] = r;
    }
    if (r.pg_payment_id != null && String(r.pg_payment_id).trim() !== '') {
      byTok[String(r.pg_payment_id).trim()] = r;
    }
  }

  const failureByPg = new Map((playMeta.failures || []).map((f) => [String(f.play_order_id), f]));

  const ordersOut = orphanRows.map((orph) => {
    const pid = orph.play_order_id != null ? String(orph.play_order_id).trim() : '';
    const tok = orph.purchase_token != null ? String(orph.purchase_token).trim() : '';
    const rawOrder = (pid && byPg[pid]) || (tok && byTok[tok]) || null;

    const internal = rawOrder
      ? orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(
          mapRowToAdminOrder(rawOrder, planById, userById, templateNameById, packNameById),
          ctxMap
        )
      : null;

    const ps = pid && playMeta.ordersById[pid] ? playMeta.ordersById[pid] : null;
    const fail = pid ? failureByPg.get(pid) : null;

    let play_fetch_error = null;
    if (!ps) {
      if (fail && fail.message) play_fetch_error = fail.message;
      else if (!playMeta.skipped) {
        play_fetch_error = pid ? 'Play order not returned' : 'No Play order id on orphan row';
      }
    }

    return {
      play_store_order: ps,
      internal_order: internal,
      play_fetch_error,
      orphan_meta: _baseOrphanMeta(orph)
    };
  });

  ordersOut.sort((a, b) => {
    const ta =
      Date.parse(a.play_store_order?.createTime || '') ||
      Date.parse(a.orphan_meta?.last_seen_at || '') ||
      0;
    const tb =
      Date.parse(b.play_store_order?.createTime || '') ||
      Date.parse(b.orphan_meta?.last_seen_at || '') ||
      0;
    return tb - ta;
  });

  return {
    ordersOut,
    extra: { play_metadata_skipped: playMeta.skipped }
  };
}

/**
 * Build the Apple-specific orphan view. We do NOT call Apple's API here (would need a separate service-account / JWT).
 * Instead we decode the `signed_transaction_info` JWS payload that photobop-api already stored at write time — that
 * payload IS Apple-signed (we just don't re-verify the signature on this read path; verification happens at write time).
 * Link to internal orders by Apple transactionId (pg_payment_id) and/or apple_app_account_token.
 */
async function _buildAppleOrphanView({ orphanRows }) {
  const decodedById = Object.create(null);
  for (const r of orphanRows) {
    const decoded = AppleOrphanDecoder.decodeSignedTransactionInfo(r.signed_transaction_info);
    if (decoded) decodedById[r.id] = decoded;
  }

  const transactionIds = orphanRows
    .map((r) => (r.purchase_token != null ? String(r.purchase_token).trim() : ''))
    .filter(Boolean);
  const appAccountTokens = orphanRows
    .map((r) => (r.apple_app_account_token != null ? String(r.apple_app_account_token).trim() : ''))
    .filter(Boolean);

  const matchRows = await OrdersModel.findAppleOrdersMatchingOrphans({
    transactionIds,
    appAccountTokens
  });

  const { planById, userById } = await stitchPlansAndUsersForRows(matchRows);
  const [templateNameById, packNameById] = await Promise.all([
    orderTemplateStitch.buildTemplateNameByIdMap(matchRows),
    orderTemplateStitch.buildPackNameByIdMap(matchRows)
  ]);
  const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(matchRows);

  const byTxId = Object.create(null);
  const byAppAccountToken = Object.create(null);
  for (const r of matchRows) {
    if (r.pg_payment_id != null && String(r.pg_payment_id).trim() !== '') {
      byTxId[String(r.pg_payment_id).trim()] = r;
    }
    if (r.apple_app_account_token != null && String(r.apple_app_account_token).trim() !== '') {
      byAppAccountToken[String(r.apple_app_account_token).trim()] = r;
    }
  }

  const ordersOut = orphanRows.map((orph) => {
    const txId = orph.purchase_token != null ? String(orph.purchase_token).trim() : '';
    const aat = orph.apple_app_account_token != null ? String(orph.apple_app_account_token).trim() : '';
    const rawOrder = (txId && byTxId[txId]) || (aat && byAppAccountToken[aat]) || null;

    const internal = rawOrder
      ? orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(
          mapRowToAdminOrder(rawOrder, planById, userById, templateNameById, packNameById),
          ctxMap
        )
      : null;

    const decoded = decodedById[orph.id] || null;
    // Mirror the shape of `play_store_order` so the UI can render with the same component skeleton.
    // Apple JWS timestamps are epoch-ms numbers; normalise to ISO so the admin-ui (which uses parseOrderDate(s))
    // can sort/format them without per-field special-cases.
    const _epochToIso = (n) => {
      if (n == null) return null;
      const num = Number(n);
      if (!Number.isFinite(num)) return null;
      const d = new Date(num);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const apple_store_transaction = decoded
      ? {
          transactionId: decoded.transactionId || null,
          originalTransactionId: decoded.originalTransactionId || null,
          bundleId: decoded.bundleId || null,
          productId: decoded.productId || null,
          type: decoded.type || null,
          inAppOwnershipType: decoded.inAppOwnershipType || null,
          environment: decoded.environment || null,
          purchaseDate: _epochToIso(decoded.purchaseDate),
          originalPurchaseDate: _epochToIso(decoded.originalPurchaseDate),
          expiresDate: _epochToIso(decoded.expiresDate),
          revocationDate: _epochToIso(decoded.revocationDate),
          revocationReason: decoded.revocationReason || null,
          quantity: decoded.quantity || null,
          storefront: decoded.storefront || null,
          price: decoded.price || null,
          currency: decoded.currency || null,
          appAccountToken: decoded.appAccountToken || orph.apple_app_account_token || null
        }
      : null;

    return {
      apple_store_transaction,
      internal_order: internal,
      orphan_meta: {
        ..._baseOrphanMeta(orph),
        apple_app_account_token: orph.apple_app_account_token,
        // Don't echo the raw JWS to the admin payload — too noisy. Decoded fields above are what reviewers need.
        signed_transaction_info_present: !!orph.signed_transaction_info
      }
    };
  });

  ordersOut.sort((a, b) => {
    const ta =
      Date.parse(a.apple_store_transaction?.purchaseDate || '') ||
      Date.parse(a.orphan_meta?.last_seen_at || '') ||
      0;
    const tb =
      Date.parse(b.apple_store_transaction?.purchaseDate || '') ||
      Date.parse(b.orphan_meta?.last_seen_at || '') ||
      0;
    return tb - ta;
  });

  return { ordersOut, extra: {} };
}

/**
 * GET /admin/orders/orphans?gateway=google_play|apple_iap
 * Unified orphan reconciliation queue. `gateway` is required; omit only via the legacy /play-store alias.
 */
exports.listAdminOrphanedOrders = async function (req, res) {
  const SUPPORTED = new Set(['google_play', 'apple_iap']);
  const gateway = req.query.gateway ? String(req.query.gateway).trim().toLowerCase() : '';
  if (!SUPPORTED.has(gateway)) {
    return res.status(400).json({ message: 'gateway must be one of: google_play, apple_iap' });
  }

  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const pageRaw = parseInt(req.query.page, 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20, 100);
    const page = Math.max(Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1, 1);
    const offset = (page - 1) * limit;

    const [total, orphanRows] = await Promise.all([
      PaymentOrphanModel.countOrphansAdmin({ gateway }),
      PaymentOrphanModel.listOrphansAdmin({ gateway, limit, offset })
    ]);

    const view = gateway === 'google_play'
      ? await _buildGooglePlayOrphanView({ orphanRows })
      : await _buildAppleOrphanView({ orphanRows });

    return res.status(200).json({
      data: {
        orders: view.ordersOut,
        page,
        limit,
        total,
        has_more: offset + orphanRows.length < total,
        gateway,
        list_kind: 'orphan_queue',
        ...view.extra
      }
    });
  } catch (err) {
    console.error('listAdminOrphanedOrders error:', { gateway, error: err && err.message ? err.message : err });
    return res.status(500).json({ message: 'Failed to list orphaned orders' });
  }
};

/**
 * Legacy alias for GET /admin/orders/play-store. Routes-old + admin UI still call this URL; we keep it working
 * by forcing gateway=google_play. Remove this once the admin UI fully cuts over to /admin/orders/orphans.
 */
exports.listAdminPlayStoreOrders = async function (req, res) {
  req.query.gateway = 'google_play';
  return exports.listAdminOrphanedOrders(req, res);
};

/**
 * GET /admin/orders/export — UTF-8 CSV (opens in Excel) for current filters; capped at MAX_EXPORT_ROWS (newest first).
 * Query `export_layout=by_user`: one row per user (sorted by user_id), with row_num, order_count, and semicolon-separated order_ids.
 */
exports.exportAdminOrdersCsv = async function (req, res) {
  try {
    const status = req.query.status ? String(req.query.status).trim() : '';
    const productType = req.query.product_type ? String(req.query.product_type).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const client_platform = req.query.client_platform ? String(req.query.client_platform).trim().toLowerCase() : '';
    const exportLayoutRaw = req.query.export_layout ? String(req.query.export_layout).trim().toLowerCase() : '';
    const exportByUser = exportLayoutRaw === 'by_user' || exportLayoutRaw === 'users';

    const filterPayload = { status, productType, search, client_platform };

    const rangeErr = mergeAdminOrdersRangeFiltersFromQuery(req, filterPayload);
    if (rangeErr) {
      return res.status(rangeErr.status).json({ message: rangeErr.message });
    }

    const preparedFilters = await OrdersModel.prepareAdminOrdersFilters(filterPayload);

    const total = await OrdersModel.countOrdersAdmin(preparedFilters);
    const exportLimit = Math.min(Math.max(total, 0), MAX_EXPORT_ROWS);
    const rows =
      exportLimit > 0 ? await OrdersModel.listOrdersAdmin({ ...preparedFilters, limit: exportLimit, offset: 0 }) : [];

    const { planById, userById } = await stitchPlansAndUsersForRows(rows);
    const [templateNameById, packNameById] = await Promise.all([
      orderTemplateStitch.buildTemplateNameByIdMap(rows),
      orderTemplateStitch.buildPackNameByIdMap(rows)
    ]);
    const ctxMap =
      rows.length <= MAX_ORDERS_ANALYTICS_ENRICH
        ? await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(rows)
        : new Map();
    const orders = rows.map((o) => {
      const base = mapRowToAdminOrder(o, planById, userById, templateNameById, packNameById);
      return orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(base, ctxMap);
    });

    const lines = [];
    let filenameBase = 'orders-export';

    if (exportByUser) {
      const aggRows = aggregateOrdersByUserForCsv(orders);
      const headers = [
        'row_num',
        'user_id',
        'order_count',
        'display_name',
        'email',
        'mobile',
        'first_order_at',
        'last_order_at',
        'order_ids'
      ];
      lines.push(headers.join(','));
      for (const r of aggRows) {
        lines.push(
          [
            csvEscape(r.row_num),
            csvEscape(r.user_id),
            csvEscape(r.order_count),
            csvEscape(r.display_name),
            csvEscape(r.email),
            csvEscape(r.mobile),
            csvEscape(r.first_order_at),
            csvEscape(r.last_order_at),
            csvEscape(r.order_ids)
          ].join(',')
        );
      }
      filenameBase = 'orders-by-user';
    } else {
      const headers = [
        'order_id',
        'user_id',
        'display_name',
        'email',
        'mobile',
        'status',
        'amount_paid',
        'currency',
        'purchase_category',
        'plan_name',
        'plan_heading',
        'billing_interval',
        'template_id',
        'template_name',
        'pack_id',
        'pack_name',
        'client_platform',
        'payment_gateway',
        'quantity',
        'created_at',
        'completed_at',
        'failed_at',
        'refunded_at',
        'analytics_app_version',
        'analytics_os_name',
        'analytics_os_version'
      ];
      lines.push(headers.join(','));
      for (const o of orders) {
        const u = o.user_details || {};
        lines.push(
          [
            csvEscape(o.order_id),
            csvEscape(o.user_id),
            csvEscape(u.display_name),
            csvEscape(u.email),
            csvEscape(u.mobile),
            csvEscape(o.status),
            csvEscape(o.amount_paid),
            csvEscape(o.currency),
            csvEscape(o.purchase_category),
            csvEscape(o.plan_name),
            csvEscape(o.plan_heading),
            csvEscape(o.billing_interval),
            csvEscape(o.template_id),
            csvEscape(o.template_name),
            csvEscape(o.pack_id),
            csvEscape(o.pack_name),
            csvEscape(o.client_platform),
            csvEscape(o.payment_gateway),
            csvEscape(o.quantity),
            csvEscape(formatCsvDate(o.created_at)),
            csvEscape(formatCsvDate(o.completed_at)),
            csvEscape(formatCsvDate(o.failed_at)),
            csvEscape(formatCsvDate(o.refunded_at)),
            csvEscape(o.analytics_app_version),
            csvEscape(o.analytics_os_name),
            csvEscape(o.analytics_os_version)
          ].join(',')
        );
      }
    }

    const body = `\uFEFF${lines.join('\r\n')}\r\n`;
    const dayStamp = new Date().toISOString().slice(0, 10);
    const filename = `${filenameBase}-${dayStamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (total > MAX_EXPORT_ROWS) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Total', String(total));
      res.setHeader('X-Export-Row-Cap', String(MAX_EXPORT_ROWS));
    }
    return res.status(200).send(body);
  } catch (err) {
    console.error('exportAdminOrdersCsv error:', err);
    return res.status(500).json({
      message: 'Failed to export orders'
    });
  }
};

const axios = require('axios');
const config = require('../../../config/config');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

function publicApiProxyRequestConfig() {
  const cfg = config.publicApi || config.photobopApi;
  const base =
    (cfg && String(cfg.baseUrl || '').trim()) || String(process.env.PHOTOBOP_API_BASE_URL || '').trim();
  const key =
    (cfg && String(cfg.internalServiceKey || '').trim()) ||
    String(process.env.PHOTOBOP_INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_KEY || '').trim();
  const routePrefixRaw =
    (cfg && String(cfg.routePrefix || '').trim()) || String(process.env.PHOTOBOP_API_ROUTE_PREFIX || '').trim();
  const routePrefix = routePrefixRaw
    ? routePrefixRaw.startsWith('/')
      ? routePrefixRaw
      : `/${routePrefixRaw}`
    : '';
  const origin = base.replace(/\/$/, '');
  return { base, key, origin, routePrefix };
}

/** Shown when publicApi / env is missing so ops can wire admin-api → photobop-api. */
function publicApiProxyNotConfiguredBody() {
  return {
    message:
      'Tellow AI public API URL or internal service key is not configured for admin-to-public-api server calls.',
    code: 'PHOTOBOP_PROXY_NOT_CONFIGURED',
    hint:
      'photobop-admin-ui VITE_* vars are not read here. Set publicApi.baseUrl (photobop-api origin, no trailing slash; same idea as VITE_PUBLIC_API_URL) and publicApi.internalServiceKey in photobop-admin-api config/env/local.js, or PHOTOBOP_API_BASE_URL and PHOTOBOP_INTERNAL_SERVICE_KEY on the admin-api process. The legacy config key photobopApi is still accepted if publicApi is omitted. Match the same secret on photobop-api. Optional publicApi.routePrefix for versioned paths.'
  };
}

/**
 * POST /admin/orders/:orderId/google-play/preview-from-console
 * Proxies to photobop-api Google `orders.get` only (no fulfillment).
 */
exports.previewGooglePlayFromConsole = async function (req, res) {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid order id' });
    }

    const { base, key, origin, routePrefix } = publicApiProxyRequestConfig();
    if (!base || !key) {
      return res.status(HTTP_STATUS_CODES.SERVICE_UNAVAILABLE).json(publicApiProxyNotConfiguredBody());
    }

    const { play_order_id: playOrderId, pg_payment_id: pgPaymentId } = req.body || {};
    if (!playOrderId || !String(playOrderId).trim()) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'play_order_id is required' });
    }

    const url = `${origin}${routePrefix}/internal/admin/orders/${orderId}/google-play/preview-by-play-order`;
    const { data } = await axios.post(
      url,
      { play_order_id: String(playOrderId).trim(), pg_payment_id: pgPaymentId ? String(pgPaymentId).trim() : undefined },
      {
        headers: { 'X-Internal-Service-Key': key, 'Content-Type': 'application/json' },
        timeout: 120000
      }
    );

    return res.status(HTTP_STATUS_CODES.OK).json(data);
  } catch (err) {
    const status = (err.response && err.response.status) || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    const body = (err.response && err.response.data) || {};
    const message = body.message || err.message || 'Google lookup failed';
    console.error('previewGooglePlayFromConsole error:', { status, message, body });
    return res.status(status).json({
      message,
      code: body.code || 'GOOGLE_PREVIEW_ERROR'
    });
  }
};

/**
 * POST /admin/orders/:orderId/google-play/fulfill-from-console
 * Proxies to photobop-api internal fulfilment (Google Play orders.get → verify path).
 */
exports.fulfillGooglePlayFromConsole = async function (req, res) {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid order id' });
    }

    const { base, key, origin, routePrefix } = publicApiProxyRequestConfig();

    if (!base || !key) {
      return res.status(HTTP_STATUS_CODES.SERVICE_UNAVAILABLE).json(publicApiProxyNotConfiguredBody());
    }

    const { play_order_id: playOrderId, pg_payment_id: pgPaymentId } = req.body || {};
    if (!playOrderId || !String(playOrderId).trim()) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'play_order_id is required' });
    }

    const url = `${origin}${routePrefix}/internal/admin/orders/${orderId}/google-play/fulfill-by-play-order`;
    const { data } = await axios.post(
      url,
      { play_order_id: String(playOrderId).trim(), pg_payment_id: pgPaymentId ? String(pgPaymentId).trim() : undefined },
      {
        headers: { 'X-Internal-Service-Key': key, 'Content-Type': 'application/json' },
        timeout: 120000
      }
    );

    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ORDER',
      actionName: 'GOOGLE_PLAY_MANUAL_FULFILL_BY_PLAY_ORDER_ID',
      entityId: String(orderId),
      additionalData: {
        play_order_id: String(playOrderId).trim(),
        had_pg_payment_id: !!(pgPaymentId && String(pgPaymentId).trim()),
        result_order_id: data && data.data ? data.data.orderId : orderId
      }
    });

    return res.status(HTTP_STATUS_CODES.OK).json(data);
  } catch (err) {
    const status = (err.response && err.response.status) || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    const body = (err.response && err.response.data) || {};
    const message = body.message || err.message || 'Fulfillment failed';
    console.error('fulfillGooglePlayFromConsole error:', { status, message, body });
    return res.status(status).json({
      message,
      code: body.code || 'FULFILLMENT_ERROR'
    });
  }
};
