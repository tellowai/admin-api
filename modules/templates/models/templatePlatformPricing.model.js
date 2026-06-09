'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { COMMERCE_PLATFORMS } = require('../utils/resolveTemplateCommerce.util');

/**
 * @param {string} templateId
 * @param {string} platform
 * @param {object} row
 */
exports.upsertPlatformPricingRow = async function (templateId, platform, row = {}) {
  const query = `
    INSERT INTO template_platform_pricing (
      template_id, platform, credits, member_price, member_original_price, alacarte_price, alacarte_original_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      credits = VALUES(credits),
      member_price = VALUES(member_price),
      member_original_price = VALUES(member_original_price),
      alacarte_price = VALUES(alacarte_price),
      alacarte_original_price = VALUES(alacarte_original_price),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
  const values = [
    templateId,
    platform,
    row.credits ?? null,
    row.member_price ?? null,
    row.member_original_price ?? null,
    row.alacarte_price ?? null,
    row.alacarte_original_price ?? null
  ];
  return mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Copy catalog defaults to all commerce platforms (create / full sync).
 * @param {string} templateId
 * @param {object} catalog
 */
exports.syncAllPlatformsFromCatalog = async function (templateId, catalog = {}) {
  for (const platform of COMMERCE_PLATFORMS) {
    await exports.upsertPlatformPricingRow(templateId, platform, {
      credits: catalog.credits,
      member_price: catalog.member_price,
      member_original_price: catalog.member_original_price,
      alacarte_price: catalog.alacarte_price,
      alacarte_original_price: catalog.alacarte_original_price
    });
  }
};

/**
 * @param {string} templateId
 * @param {object} [platformPricing] - { android?: object, ios?: object, web?: object }
 */
exports.upsertPlatformPricingFromPayload = async function (templateId, platformPricing = {}) {
  for (const platform of COMMERCE_PLATFORMS) {
    const row = platformPricing[platform];
    if (row && typeof row === 'object') {
      await exports.upsertPlatformPricingRow(templateId, platform, row);
    }
  }
};

/**
 * @param {string[]} templateIds
 * @returns {Promise<object[]>}
 */
exports.getPlatformPricingByTemplateIds = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) return [];
  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT template_id, platform, credits, member_price, member_original_price, alacarte_price, alacarte_original_price
    FROM template_platform_pricing
    WHERE template_id IN (${placeholders})
  `;
  return mysqlQueryRunner.runQueryInSlave(query, templateIds);
};

/**
 * @param {object[]} rows
 * @returns {{ android: object, ios: object, web: object }}
 */
exports.buildPlatformPricingMapFromRows = function (rows) {
  const map = { android: {}, ios: {}, web: {} };
  for (const row of rows || []) {
    const platform = row && row.platform;
    if (!platform || !Object.prototype.hasOwnProperty.call(map, platform)) continue;
    map[platform] = {
      credits: row.credits,
      member_price: row.member_price,
      member_original_price: row.member_original_price,
      alacarte_price: row.alacarte_price,
      alacarte_original_price: row.alacarte_original_price
    };
  }
  return map;
};
