'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listSectionItems = async function(sectionId, pagination) {
  const query = `
    SELECT 
      explore_section_item_id,
      section_id,
      resource_type,
      resource_id,
      sort_order,
      created_at
    FROM explore_section_items
    WHERE section_id = ?
    AND archived_at IS NULL
    ORDER BY sort_order ASC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [sectionId, pagination.limit, pagination.offset]
  );
};

exports.getTemplatesForItems = async function(templateIds) {
  if (!templateIds.length) return [];
  
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      cf_r2_key
    FROM templates
    WHERE template_id IN (?)
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

exports.getCollectionsForItems = async function(collectionIds) {
  if (!collectionIds.length) return [];
  
  const query = `
    SELECT 
      collection_id,
      collection_name,
      thumbnail_cf_r2_key as resource_image_key
    FROM collections
    WHERE collection_id IN (?)
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [collectionIds]);
};

/**
 * Hydrate pack rows for the admin section-items list. Keeps the same column
 * shape as templates/collections so the controller can enrich uniformly.
 */
exports.getPacksForItems = async function(packIds) {
  if (!packIds.length) return [];

  const query = `
    SELECT
      pack_id,
      pack_name,
      thumbnail_cf_r2_key as resource_image_key
    FROM packs
    WHERE pack_id IN (?)
      AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [packIds]);
};

/**
 * Count non-archived items in a section, optionally narrowed to a resource_type.
 * Used to enforce per-ui_type rules (e.g. pack_templates allows exactly one pack).
 */
exports.countSectionItems = async function(sectionId, resourceType = null) {
  let query = `
    SELECT COUNT(*) AS cnt
    FROM explore_section_items
    WHERE section_id = ?
      AND archived_at IS NULL
  `;
  const params = [sectionId];
  if (resourceType) {
    query += ` AND resource_type = ?`;
    params.push(resourceType);
  }
  const rows = await mysqlQueryRunner.runQueryInSlave(query, params);
  return rows && rows[0] ? Number(rows[0].cnt) || 0 : 0;
};

exports.getExistingItems = async function(sectionId, items) {
  const conditions = items.map(item => 
    `(section_id = ? AND resource_type = ? AND resource_id = ? AND archived_at IS NULL)`
  ).join(' OR ');

  const values = items.flatMap(item => [sectionId, item.resource_type, item.resource_id]);

  const query = `
    SELECT 
      resource_type,
      resource_id
    FROM explore_section_items
    WHERE ${conditions}
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, values);
};

exports.bulkInsertItems = async function(items) {
  const values = items.map(item => [
    item.section_id,
    item.resource_type,
    item.resource_id,
    item.sort_order || 0
  ]);

  const query = `
    INSERT INTO explore_section_items (
      section_id,
      resource_type,
      resource_id,
      sort_order
    ) VALUES ?
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [values]);
};

exports.removeSectionItems = async function(sectionId, itemIds) {
  const query = `
    UPDATE explore_section_items 
    SET archived_at = NOW()
    WHERE explore_section_item_id IN (?)
    AND section_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [itemIds, sectionId]);
  return result.affectedRows > 0;
};

/**
 * Archive direct template section rows on Explore vs Effects surfaces (see explore_sections.app_surface).
 * Used when a template's is_effects flag changes so it no longer appears on the wrong tab's sections.
 *
 * @param {string} templateId
 * @param {'explore'|'effects'} appSurface - surface to remove placements from
 * @returns {Promise<number>} affectedRows
 */
exports.archiveDirectTemplateItemsOnSurface = async function (templateId, appSurface) {
  if (appSurface !== 'explore' && appSurface !== 'effects') {
    throw new Error('archiveDirectTemplateItemsOnSurface: appSurface must be explore or effects');
  }

  const query = `
    UPDATE explore_section_items esi
    INNER JOIN explore_sections es ON es.section_id = esi.section_id AND es.archived_at IS NULL
    SET esi.archived_at = NOW()
    WHERE esi.resource_type = 'template'
    AND esi.resource_id = ?
    AND esi.archived_at IS NULL
    AND es.app_surface = ?
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [templateId, appSurface]);
  return result.affectedRows ?? 0;
};

/**
 * @param {string|number} collectionId
 * @param {{ is_effects?: boolean }} [options] - when true/false, join templates and limit by is_effects (Explore vs Effects parity)
 */
exports.getCollectionTemplateIds = async function (collectionId, options = {}) {
  let effectsClause = '';
  if (options.is_effects === true) {
    effectsClause = ' AND (t.is_effects = 1 OR t.is_effects = TRUE)';
  } else if (options.is_effects === false) {
    effectsClause = ' AND (t.is_effects IS NULL OR t.is_effects = 0 OR t.is_effects = FALSE)';
  }

  const query = `
    SELECT 
      ct.template_id,
      ct.sort_order,
      ct.created_at
    FROM collection_templates ct
    INNER JOIN templates t ON t.template_id = ct.template_id AND t.archived_at IS NULL
    WHERE ct.collection_id = ?
    AND ct.archived_at IS NULL
    ${effectsClause}
    ORDER BY ct.sort_order ASC, ct.created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [collectionId]);
};

/**
 * Non-archived item IDs for a section (unordered; caller compares multiset).
 */
exports.listSectionItemIds = async function(sectionId) {
  const query = `
    SELECT explore_section_item_id
    FROM explore_section_items
    WHERE section_id = ?
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [sectionId]);
};

/**
 * Apply sort_order by array position (0-based) for the given item IDs.
 * @param {number|string} sectionId
 * @param {string[]} orderedItemIds - explore_section_item_id values in display order
 */
exports.updateSectionItemsSortOrder = async function(sectionId, orderedItemIds) {
  if (!orderedItemIds.length) {
    return { affectedRows: 0 };
  }

  const caseLines = orderedItemIds.map(() => 'WHEN ? THEN ?').join('\n      ');
  const params = [];
  orderedItemIds.forEach((id, index) => {
    params.push(id, index);
  });
  const inPlaceholders = orderedItemIds.map(() => '?').join(',');
  params.push(sectionId, ...orderedItemIds);

  const query = `
    UPDATE explore_section_items
    SET sort_order = CASE explore_section_item_id
      ${caseLines}
    END
    WHERE section_id = ?
    AND archived_at IS NULL
    AND explore_section_item_id IN (${inPlaceholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, params);
}; 