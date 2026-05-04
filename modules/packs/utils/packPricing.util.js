'use strict';

/**
 * Pack-level credits and INR à la carte aggregates, recomputed when pack membership changes.
 * Tier list must stay aligned with modules/templates/validators/schema/template.schema.js (ALACARTE_INR_PRICE_TIERS).
 * Credit→INR path mirrors photobop-api/modules/payment/constants/pricing.constants.js + alacarte.service calculateInrTier.
 */

const PackModel = require('../models/pack.model');

/** @type {number[]} */
const ALACARTE_INR_PRICE_TIERS = [
  19, 29, 49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 549, 599, 649, 699, 749, 799, 849, 899, 949, 999
];

const USD_TO_CREDITS_RATE = 50;
const USD_TO_INR_RATE = 83.33;

function creditsToInrFloored(credits) {
  const usdAmount = credits / USD_TO_CREDITS_RATE;
  return Math.floor(usdAmount * USD_TO_INR_RATE);
}

/**
 * Per-template effective INR sale (explicit alacarte_price or tier from credits), matching AlacarteService.
 * @param {{ credits?: number|null, alacarte_price?: number|null }} template
 * @returns {number}
 */
function effectiveTemplateSaleInr(template) {
  const explicit = Number(template.alacarte_price);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const c = Number(template.credits) || 0;
  if (c <= 0) {
    return 0;
  }
  const rawInr = creditsToInrFloored(c);
  if (rawInr <= 49) {
    return 49;
  }
  const bucket = Math.floor(rawInr / 50);
  const tiered = bucket * 50 + 49;
  return Math.min(tiered, 499);
}

/**
 * @param {{ credits?: number|null, alacarte_price?: number|null, alacarte_original_price?: number|null }} template
 * @returns {number}
 */
function effectiveTemplateOriginalInr(template) {
  const orig = Number(template.alacarte_original_price);
  if (Number.isFinite(orig) && orig > 0) {
    return orig;
  }
  return effectiveTemplateSaleInr(template);
}

/**
 * Smallest dropdown tier >= rawSum, or top tier if rawSum exceeds list.
 * @param {number} rawSum
 * @returns {number|null}
 */
function ceilingToAlacarteDropdownInr(rawSum) {
  if (!Number.isFinite(rawSum) || rawSum <= 0) {
    return null;
  }
  const hit = ALACARTE_INR_PRICE_TIERS.find((tier) => tier >= rawSum);
  if (hit != null) {
    return hit;
  }
  return ALACARTE_INR_PRICE_TIERS[ALACARTE_INR_PRICE_TIERS.length - 1];
}

/**
 * @param {Array<{ credits?: number|null, alacarte_price?: number|null, alacarte_original_price?: number|null }>} templates
 * @returns {{ credits: number, alacarte_price: number|null, alacarte_original_price: number|null }}
 */
function computePackAggregatesFromTemplates(templates) {
  if (!templates || !templates.length) {
    return { credits: 0, alacarte_price: null, alacarte_original_price: null };
  }
  let credits = 0;
  let saleSum = 0;
  let origSum = 0;
  for (const t of templates) {
    credits += Number(t.credits) || 0;
    saleSum += effectiveTemplateSaleInr(t);
    origSum += effectiveTemplateOriginalInr(t);
  }
  return {
    credits,
    alacarte_price: ceilingToAlacarteDropdownInr(saleSum),
    alacarte_original_price: ceilingToAlacarteDropdownInr(origSum)
  };
}

/**
 * Load active pack templates, hydrate template rows, update packs.credits and pack INR columns.
 * @param {string} packId
 */
async function recomputePackPricing(packId) {
  const packTemplates = await PackModel.getPackTemplates(packId);
  if (!packTemplates.length) {
    await PackModel.updatePackPricing(packId, {
      credits: 0,
      alacarte_price: null,
      alacarte_original_price: null
    });
    return;
  }
  const templateIds = packTemplates.map((pt) => pt.template_id);
  const templates = await PackModel.getTemplatesByIds(templateIds);
  const agg = computePackAggregatesFromTemplates(templates);
  await PackModel.updatePackPricing(packId, agg);
}

module.exports = {
  ALACARTE_INR_PRICE_TIERS,
  recomputePackPricing,
  computePackAggregatesFromTemplates,
  ceilingToAlacarteDropdownInr,
  effectiveTemplateSaleInr
};
