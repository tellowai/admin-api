'use strict';

function normPlanField(v) {
  if (v == null || v === '') return '';
  const s = typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return s.trim().toLowerCase();
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

module.exports = {
  normPlanField,
  purchaseCategoryFromPlan
};
