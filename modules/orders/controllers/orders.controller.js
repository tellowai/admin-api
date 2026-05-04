'use strict';

const OrdersModel = require('../models/orders.model');
const PaymentPlansModel = require('../../payment-plans/models/payment-plans.model');
const GenerationsModel = require('../../generations/models/generations.model');

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

function mapRowToAdminOrder(o, planById, userById) {
  const plan = o.payment_plan_id != null ? planById[o.payment_plan_id] : null;
  const planType = plan ? plan.plan_type : null;
  const billingInterval = plan ? plan.billing_interval : null;
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
    user_details: userById[o.user_id] || null
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
    const orders = rows.map((o) => mapRowToAdminOrder(o, planById, userById));

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
    const orders = rows.map((o) => mapRowToAdminOrder(o, planById, userById));

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
      'client_platform',
      'payment_gateway',
      'quantity',
      'created_at',
      'completed_at',
      'failed_at',
      'refunded_at'
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
          csvEscape(o.client_platform),
          csvEscape(o.payment_gateway),
          csvEscape(o.quantity),
          csvEscape(formatCsvDate(o.created_at)),
          csvEscape(formatCsvDate(o.completed_at)),
          csvEscape(formatCsvDate(o.failed_at)),
          csvEscape(formatCsvDate(o.refunded_at))
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
