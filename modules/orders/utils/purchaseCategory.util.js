'use strict';

const { parseTransactionNotesObject } = require('./orderTemplateStitch.util');

function normPlanField(v) {
  if (v == null || v === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.trim().toLowerCase();
}

/**
 * Renewal ledger orders (OrderService.createRenewalOrder) tag transaction_notes.
 *
 * @param {unknown} transactionNotes
 * @returns {boolean}
 */
function isSubscriptionRenewalFromTransactionNotes(transactionNotes) {
  const parsed = parseTransactionNotesObject(transactionNotes);
  if (!parsed) return false;
  const subject =
    parsed.purchase_subject != null ? String(parsed.purchase_subject).trim().toLowerCase() : '';
  if (subject === 'subscription_renewal') return true;
  if (parsed.renewal === true || parsed.renewal === 'true' || parsed.renewal === 1) return true;
  return false;
}

/**
 * Badge bucket — payment_plans.plan_type + billing_interval.
 * Aligned with admin Purchases analytics and orders list.
 *
 * @param {string|null|undefined} planType
 * @param {string|null|undefined} billingInterval
 * @returns {'alacarte'|'subscription'|'onetime'|'addon'|'other'}
 */
function purchaseCategoryFromPlan(planType, billingInterval) {
  const pt = normPlanField(planType);
  const bi = normPlanField(billingInterval);
  if (pt === 'credits') {
    if (bi === 'monthly' || bi === 'yearly') return 'subscription';
    return 'onetime';
  }
  if ((pt === 'single' || pt === 'bundle') && (bi === 'alacarte' || bi === 'onetime')) return 'alacarte';
  if (pt === 'addon' && bi === 'onetime') return 'addon';
  return 'other';
}

/**
 * Order list badge: renewal ledger rows override plan-based "subscription".
 *
 * @param {string|null|undefined} planType
 * @param {string|null|undefined} billingInterval
 * @param {unknown} [transactionNotes]
 * @returns {'alacarte'|'subscription'|'subscription_renewal'|'onetime'|'addon'|'other'}
 */
function purchaseCategoryFromOrder(planType, billingInterval, transactionNotes) {
  if (isSubscriptionRenewalFromTransactionNotes(transactionNotes)) {
    return 'subscription_renewal';
  }
  return purchaseCategoryFromPlan(planType, billingInterval);
}

module.exports = {
  normPlanField,
  isSubscriptionRenewalFromTransactionNotes,
  purchaseCategoryFromPlan,
  purchaseCategoryFromOrder
};
