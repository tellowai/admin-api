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
      thumbnail_cf_r2_key
    FROM collections
    WHERE collection_id IN (?)
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [collectionIds]);
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