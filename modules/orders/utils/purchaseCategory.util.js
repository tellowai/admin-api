'use strict';

function normPlanField(v) {
  if (v == null || v === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.trim().toLowerCase();
}

function extractPurchaseSubjectFromTransactionNotes(transactionNotes) {
  if (transactionNotes == null || transactionNotes === '') return '';
  let obj = transactionNotes;
  if (typeof transactionNotes === 'string') {
    try {
      obj = JSON.parse(transactionNotes);
    } catch {
      return '';
    }
  }
  if (!obj || typeof obj !== 'object') return '';
  const ps = obj.purchase_subject;
  return ps != null ? String(ps).trim() : '';
}

/**
 * Badge bucket — payment_plans.plan_type + billing_interval.
 * Aligned with admin Purchases analytics and orders list.
 *
 * @param {string|null|undefined} planType
 * @param {string|null|undefined} billingInterval
 * @returns {'alacarte'|'subscription'|'subscription_renewal'|'onetime'|'addon'|'other'}
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
 * Overrides plan bucket when ledger stored `purchase_subject=subscription_renewal`.
 *
 * @param {{ transaction_notes?: any }} orderRow
 * @param {{ plan_type?: string, billing_interval?: string } | null | undefined} plan
 * @returns {'alacarte'|'subscription'|'subscription_renewal'|'onetime'|'addon'|'other'}
 */
function purchaseCategoryFromOrder(orderRow, plan) {
  const raw = extractPurchaseSubjectFromTransactionNotes(orderRow && orderRow.transaction_notes);
  if (normPlanField(raw) === 'subscription_renewal') return 'subscription_renewal';
  return purchaseCategoryFromPlan(plan?.plan_type, plan?.billing_interval);
}

module.exports = {
  normPlanField,
  purchaseCategoryFromPlan,
  extractPurchaseSubjectFromTransactionNotes,
  purchaseCategoryFromOrder
};
