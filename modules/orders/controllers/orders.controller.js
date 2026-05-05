'use strict';

const OrdersModel = require('../models/orders.model');
const PaymentPlansModel = require('../../payment-plans/models/payment-plans.model');
const GenerationsModel = require('../../generations/models/generations.model');
const orderTemplateStitch = require('../utils/orderTemplateStitch.util');
const orderLifecycleAnalyticsEnrichment = require('../utils/ordersLifecycleAnalyticsEnrichment.util');

function normPlanField(v) {
  if (v == null || v === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.trim().toLowerCase();
}

/**
 * Badge bucket — payment_plans.plan_type + billing_interval (stitched in controller from payment_plans).
 * Credits: only monthly|yearly are subscriptions; all other credit packs (onetime, NULL, legacy rows) are one-time.
 * alacarte: single|bundle + alacarte · addon: addon + onetime
 */
function purchaseCategoryFromPlan(planType, billingInterval) {
  const pt = normPlanField(planType);
  const bi = normPlanField(billingInterval);
  if (pt === 'credits') {
    if (bi === 'monthly' || bi === 'yearly') return 'subscription';
    return 'onetime';
  }
  if ((pt === 'single' || pt === 'bundle') && bi === 'alacarte') return 'alacarte';
  if (pt === 'addon' && bi === 'onetime') return 'addon';
  return 'other';
}

const MAX_EXPORT_ROWS = 25000;
/** Skip ClickHouse enrichment on CSV export above this many rows (single IN clause). */
const MAX_ORDERS_ANALYTICS_ENRICH = 2000;

function mapRowToAdminOrder(o, planById, userById, templateNameById) {
  const plan = o.payment_plan_id != null ? planById[o.payment_plan_id] : null;
  const planType = plan ? plan.plan_type : null;
  const billingInterval = plan ? plan.billing_interval : null;
  const templateId = orderTemplateStitch.parseTemplateIdFromTransactionNotes(o.transaction_notes);
  const templateName =
    templateId && templateNameById && Object.prototype.hasOwnProperty.call(templateNameById, templateId)
      ? templateNameById[templateId]
      : null;
  return {
    order_id: o.order_id,
    user_id: o.user_id,
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
    purchase_category: purchaseCategoryFromPlan(planType, billingInterval),
    user_details: userById[o.user_id] || null,
    template_id: templateId,
    template_name: templateName,
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

    const preparedFilters = await OrdersModel.prepareAdminOrdersFilters(filterPayload);

    const [total, rows] = await Promise.all([
      OrdersModel.countOrdersAdmin(preparedFilters),
      OrdersModel.listOrdersAdmin({ ...preparedFilters, limit, offset })
    ]);

    const { planById, userById } = await stitchPlansAndUsersForRows(rows);
    const templateNameById = await orderTemplateStitch.buildTemplateNameByIdMap(rows);
    const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(rows);
    const orders = rows.map((o) => {
      const base = mapRowToAdminOrder(o, planById, userById, templateNameById);
      return orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(base, ctxMap);
    });

    return res.status(200).json({
      data: {
        orders,
        page,
        limit,
        total,
        has_more: offset + orders.length < total
      }
    });
  } catch (err) {
    console.error('listAdminOrders error:', err);
    return res.status(500).json({
      message: 'Failed to list orders'
    });
  }
};

/**
 * GET /admin/orders/export — UTF-8 CSV (opens in Excel) for current filters; capped at MAX_EXPORT_ROWS (newest first).
 */
exports.exportAdminOrdersCsv = async function (req, res) {
  try {
    const status = req.query.status ? String(req.query.status).trim() : '';
    const productType = req.query.product_type ? String(req.query.product_type).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const client_platform = req.query.client_platform ? String(req.query.client_platform).trim().toLowerCase() : '';

    const filterPayload = { status, productType, search, client_platform };
    const preparedFilters = await OrdersModel.prepareAdminOrdersFilters(filterPayload);

    const total = await OrdersModel.countOrdersAdmin(preparedFilters);
    const exportLimit = Math.min(Math.max(total, 0), MAX_EXPORT_ROWS);
    const rows =
      exportLimit > 0 ? await OrdersModel.listOrdersAdmin({ ...preparedFilters, limit: exportLimit, offset: 0 }) : [];

    const { planById, userById } = await stitchPlansAndUsersForRows(rows);
    const templateNameById = await orderTemplateStitch.buildTemplateNameByIdMap(rows);
    const ctxMap =
      rows.length <= MAX_ORDERS_ANALYTICS_ENRICH
        ? await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(rows)
        : new Map();
    const orders = rows.map((o) => {
      const base = mapRowToAdminOrder(o, planById, userById, templateNameById);
      return orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(base, ctxMap);
    });

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

    const lines = [headers.join(',')];
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

    const body = `\uFEFF${lines.join('\r\n')}\r\n`;
    const dayStamp = new Date().toISOString().slice(0, 10);
    const filename = `orders-export-${dayStamp}.csv`;

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
      'Photobop API URL or internal service key is not configured for admin-to-photobop server calls.',
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
