'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.addTemplatesToCollection = async function(collectionId, templateIds) {
  // Prepare values for bulk insert
  const values = [];
  const placeholders = [];

  templateIds.forEach(templateId => {
    values.push(collectionId, templateId);
    placeholders.push('(?, ?, NULL)');
  });

  const insertQuery = `
    INSERT IGNORE INTO collection_templates (
      collection_id,
      template_id,
      sort_order
    ) VALUES ${placeholders.join(', ')}
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.removeTemplatesFromCollection = async function(collectionId, templateIds) {
  const query = `
    UPDATE collection_templates 
    SET archived_at = NOW()
    WHERE collection_id = ?
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [collectionId, templateIds]);
  return result.affectedRows;
};

exports.checkTemplatesInCollection = async function(collectionId, templateIds) {
  const query = `
    SELECT template_id
    FROM collection_templates
    WHERE collection_id = ?
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [collectionId, templateIds]);
  return existingTemplates;
};

exports.addTemplatesToCollections = async function(collectionIds, templateIds) {
  // Prepare values for bulk insert
  const values = [];
  const placeholders = [];

  collectionIds.forEach(collectionId => {
    templateIds.forEach(templateId => {
      values.push(collectionId, templateId);
      placeholders.push('(?, ?, NULL)');
    });
  });

  const insertQuery = `
    INSERT IGNORE INTO collection_templates (
      collection_id,
      template_id,
      sort_order
    ) VALUES ${placeholders.join(', ')}
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.checkCollectionsExist = async function(collectionIds) {
  const query = `
    SELECT collection_id
    FROM collections
    WHERE collection_id IN (?)
    AND archived_at IS NULL
  `;

  const existingCollections = await mysqlQueryRunner.runQueryInSlave(query, [collectionIds]);
  return existingCollections;
};

exports.checkCollectionExists = async function(collectionId) {
  const query = `
    SELECT collection_id
    FROM collections
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const [collection] = await mysqlQueryRunner.runQueryInSlave(query, [collectionId]);
  return !!collection;
};

exports.checkTemplatesExist = async function(templateIds) {
  const query = `
    SELECT template_id
    FROM templates
    WHERE template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
  return existingTemplates;
};

exports.checkTemplatesNotInCollections = async function(collectionIds, templateIds) {
  const query = `
    SELECT collection_id, template_id
    FROM collection_templates
    WHERE collection_id IN (?)
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [collectionIds, templateIds]);
  return existingTemplates;
};

exports.checkTemplatesNotInCollection = async function(collectionId, templateIds) {
  const query = `
    SELECT template_id
    FROM collection_templates
    WHERE collection_id = ?
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [collectionId, templateIds]);
  return existingTemplates;
};

exports.getCollectionTemplates = async function(collectionId, pagination) {
  const query = `
    SELECT 
      collection_template_id,
      template_id,
      sort_order,
      created_at
    FROM collection_templates
    WHERE collection_id = ?
    AND archived_at IS NULL
    ORDER BY sort_order ASC, created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [collectionId, pagination.limit, pagination.offset]
  );
};

const COLLECTION_TEMPLATE_SELECT_FIELDS = `
      template_id,
      template_name,
      template_code,
      template_output_type,
      description,
      prompt,
      faces_needed,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      credits,
      additional_data,
      created_at
`;

exports.getTemplatesByIds = async function(templateIds) {
  const query = `
    SELECT 
      ${COLLECTION_TEMPLATE_SELECT_FIELDS}
    FROM templates
    WHERE template_id IN (?)
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

exports.countCollectionTemplates = async function(collectionId) {
  const query = `
    SELECT COUNT(*) AS total
    FROM collection_templates
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const [row] = await mysqlQueryRunner.runQueryInSlave(query, [collectionId]);
  return Number(row?.total) || 0;
};

exports.getTemplateIdsByFacetTagCodes = async function(facetKey, tagCodes) {
  if (!facetKey || !tagCodes || tagCodes.length === 0) {
    return [];
  }

  const placeholders = tagCodes.map(() => '?').join(',');
  const tagDefQuery = `
    SELECT ttd.ttd_id
    FROM template_tag_definitions ttd
    INNER JOIN template_tag_facets f ON f.facet_id = ttd.facet_id
    WHERE f.facet_key = ?
    AND ttd.tag_code IN (${placeholders})
    AND ttd.archived_at IS NULL
    AND f.archived_at IS NULL
  `;

  const tagDefinitions = await mysqlQueryRunner.runQueryInSlave(tagDefQuery, [facetKey, ...tagCodes]);
  if (tagDefinitions.length === 0) {
    return [];
  }

  const tagDefIds = tagDefinitions.map(td => td.ttd_id);
  const templateIdsQuery = `
    SELECT DISTINCT template_id
    FROM template_tags
    WHERE ttd_id IN (${tagDefIds.map(() => '?').join(',')})
    AND deleted_at IS NULL
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(templateIdsQuery, tagDefIds);
  return results.map(row => row.template_id);
};

exports.getTemplateIdsMatchingFacetFilters = async function(facetFilters) {
  if (!facetFilters || facetFilters.length === 0) {
    return null;
  }

  let intersection = null;

  for (const facetFilter of facetFilters) {
    const tagCodes = Array.isArray(facetFilter.tagCodes) ? facetFilter.tagCodes : [facetFilter.tagCodes];
    const ids = await exports.getTemplateIdsByFacetTagCodes(facetFilter.facet, tagCodes);
    const idSet = new Set(ids);

    if (intersection === null) {
      intersection = idSet;
    } else {
      intersection = new Set([...intersection].filter((id) => idSet.has(id)));
    }

    if (intersection.size === 0) {
      return [];
    }
  }

  return [...intersection];
};

async function buildTemplatesFilterContext(facetFilters, attributeFilters) {
  let templateIds = null;

  if (facetFilters && facetFilters.length > 0) {
    templateIds = await exports.getTemplateIdsMatchingFacetFilters(facetFilters);
    if (templateIds.length === 0) {
      return null;
    }
  }

  const whereConditions = [];
  const queryParams = [];

  Object.keys(attributeFilters || {}).forEach(attrName => {
    const filter = attributeFilters[attrName];
    if (filter.op === '=') {
      whereConditions.push(`${attrName} = ?`);
      queryParams.push(filter.value);
    } else if (filter.op === 'IN') {
      const placeholders = filter.values.map(() => '?').join(',');
      whereConditions.push(`${attrName} IN (${placeholders})`);
      queryParams.push(...filter.values);
    }
  });

  if (templateIds && templateIds.length > 0) {
    const placeholders = templateIds.map(() => '?').join(',');
    whereConditions.push(`template_id IN (${placeholders})`);
    queryParams.push(...templateIds);
  }

  if (whereConditions.length === 0) {
    return null;
  }

  return {
    whereClause: whereConditions.join(' AND '),
    queryParams
  };
}

exports.countTemplatesByFilters = async function(facetFilters, attributeFilters) {
  const filterContext = await buildTemplatesFilterContext(facetFilters, attributeFilters);
  if (!filterContext) {
    return 0;
  }

  const query = `
    SELECT COUNT(*) AS total
    FROM templates
    WHERE ${filterContext.whereClause}
    AND archived_at IS NULL
  `;

  const [row] = await mysqlQueryRunner.runQueryInSlave(query, filterContext.queryParams);
  return Number(row?.total) || 0;
};

exports.getTemplatesByFilters = async function(facetFilters, attributeFilters, pagination) {
  const filterContext = await buildTemplatesFilterContext(facetFilters, attributeFilters);
  if (!filterContext) {
    return [];
  }

  const query = `
    SELECT 
      ${COLLECTION_TEMPLATE_SELECT_FIELDS}
    FROM templates
    WHERE ${filterContext.whereClause}
    AND archived_at IS NULL
    ORDER BY updated_at DESC, template_id DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query,
    [...filterContext.queryParams, pagination.limit, pagination.offset]
  );
};