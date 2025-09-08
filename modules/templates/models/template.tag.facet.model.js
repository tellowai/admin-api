'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllTemplateTagFacets = async function() {
  const query = `
    SELECT 
      facet_id,
      facet_key,
      display_name,
      cardinality,
      strict,
      required_for_publish,
      visible,
      allow_suggestions,
      created_at,
      updated_at
    FROM template_tag_facets
    WHERE archived_at IS NULL
    ORDER BY display_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query);
};

exports.getTemplateTagFacetById = async function(facetId) {
  const query = `
    SELECT 
      facet_id,
      facet_key,
      display_name,
      cardinality,
      strict,
      required_for_publish,
      visible,
      allow_suggestions,
      created_at,
      updated_at
    FROM template_tag_facets
    WHERE facet_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [facetId]);
  return result.length > 0 ? result[0] : null;
};

exports.getTemplateTagFacetByKey = async function(facetKey) {
  const query = `
    SELECT 
      facet_id,
      facet_key,
      display_name,
      cardinality,
      strict,
      required_for_publish,
      visible,
      allow_suggestions,
      created_at,
      updated_at
    FROM template_tag_facets
    WHERE facet_key = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [facetKey]);
  return result.length > 0 ? result[0] : null;
};

exports.checkTemplateTagFacetExists = async function(facetId) {
  const query = `
    SELECT facet_id 
    FROM template_tag_facets 
    WHERE facet_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [facetId]);
  return result.length > 0;
};

exports.getTemplateTagFacetsByIds = async function(facetIds) {
  if (!facetIds || facetIds.length === 0) {
    return [];
  }

  const placeholders = facetIds.map(() => '?').join(',');
  const query = `
    SELECT 
      facet_id,
      facet_key,
      display_name,
      cardinality,
      strict,
      required_for_publish,
      visible,
      allow_suggestions,
      created_at,
      updated_at
    FROM template_tag_facets
    WHERE facet_id IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY display_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, facetIds);
};
