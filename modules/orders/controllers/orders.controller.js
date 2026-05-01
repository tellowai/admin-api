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

    const orders = rows.map((o) => {
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
