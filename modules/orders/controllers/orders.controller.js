'use strict';

const OrdersModel = require('../models/orders.model');
const GenerationsModel = require('../../generations/models/generations.model');

function normPlanField(v) {
  if (v == null || v === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.trim().toLowerCase();
}

/**
 * Badge bucket — payment_plans.plan_type + billing_interval (orders list JOIN).
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

    const filterPayload = { status, productType, search };

    const [total, rows] = await Promise.all([
      OrdersModel.countOrdersAdmin(filterPayload),
      OrdersModel.listOrdersAdmin({ ...filterPayload, limit, offset })
    ]);

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    const users = userIds.length ? await GenerationsModel.getUsersByIds(userIds) : [];
    const userById = {};
    for (const u of users) {
      userById[u.user_id] = u;
    }

    const orders = rows.map((o) => ({
      order_id: o.order_id,
      user_id: o.user_id,
      payment_gateway: o.payment_gateway,
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
      plan_type: o.plan_type ?? null,
      plan_name: o.plan_name ?? null,
      plan_heading: o.plan_heading ?? null,
      billing_interval: o.billing_interval ?? null,
      purchase_category: purchaseCategoryFromPlan(o.plan_type, o.billing_interval),
      user_details: userById[o.user_id] || null
    }));

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
