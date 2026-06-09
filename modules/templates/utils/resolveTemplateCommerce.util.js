'use strict';

const COMMERCE_PLATFORMS = ['android', 'ios', 'web'];

function normalizeCommercePlatform(value) {
  if (value === undefined || value === null || value === '') {
    return 'web';
  }
  const v = String(value).trim().toLowerCase();
  if (v === 'ios' || v === 'iphone' || v === 'ipados') return 'ios';
  if (v === 'android') return 'android';
  if (v === 'web') return 'web';
  return 'web';
}

function coalesceCommerceInt(platformVal, catalogVal) {
  if (platformVal !== undefined && platformVal !== null) {
    const n = Number(platformVal);
    if (Number.isFinite(n)) return Math.round(n);
  }
  if (catalogVal !== undefined && catalogVal !== null) {
    const n = Number(catalogVal);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function resolveTemplateCommerce(catalogRow, platformRow, platform = 'web') {
  const catalog = catalogRow || {};
  const plat = platformRow || {};

  return {
    platform,
    credits: coalesceCommerceInt(plat.credits, catalog.credits),
    member_price: coalesceCommerceInt(plat.member_price, catalog.member_price),
    member_original_price: coalesceCommerceInt(plat.member_original_price, catalog.member_original_price),
    alacarte_price: coalesceCommerceInt(plat.alacarte_price, catalog.alacarte_price),
    alacarte_original_price: coalesceCommerceInt(plat.alacarte_original_price, catalog.alacarte_original_price)
  };
}

function indexPlatformPricingByTemplate(rows) {
  const byTemplate = new Map();
  for (const row of rows || []) {
    const tid = row.template_id;
    if (!tid) continue;
    if (!byTemplate.has(tid)) {
      byTemplate.set(tid, new Map());
    }
    byTemplate.get(tid).set(String(row.platform), row);
  }
  return byTemplate;
}

module.exports = {
  COMMERCE_PLATFORMS,
  normalizeCommercePlatform,
  resolveTemplateCommerce,
  indexPlatformPricingByTemplate
};
