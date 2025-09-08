'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List all facets with their associated tags from the database
 */
exports.listAllTemplateFacetsWithTags = async function() {
  // First get all facets from the database
  const facets = await this.listAllTemplateTagFacets();
  
  // Get all tags for each facet
  const facetsWithTags = await Promise.all(
    facets.map(async (facet) => {
      const tags = await this.getTagsForFacet(facet.facet_id);
      return {
        facet_id: facet.facet_id,
        facet_key: facet.facet_key,
        facet_name: facet.facet_key, // For backward compatibility
        facet_display_name: facet.display_name,
        description: `${facet.display_name} tags for templates`,
        cardinality: facet.cardinality,
        strict: facet.strict,
        required_for_publish: facet.required_for_publish,
        visible: facet.visible,
        allow_suggestions: facet.allow_suggestions,
        tags: tags,
        tag_count: tags.length,
        created_at: facet.created_at,
        updated_at: facet.updated_at
      };
    })
  );

  return facetsWithTags;
};

/**
 * Get tags for a specific facet by facet_id
 */
exports.getTagsForFacet = async function(facetId) {
  if (!facetId) {
    return [];
  }

  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE facet_id = ?
    AND archived_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [facetId]);
};

/**
 * List tags for a specific facet with pagination
 */
exports.listTemplateFacetTags = async function(facetKey, pagination) {
  // First get the facet by key
  const facet = await this.getTemplateTagFacetByKey(facetKey);
  if (!facet) {
    return [];
  }

  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE facet_id = ?
    AND archived_at IS NULL
    AND is_active = 1
    ORDER BY tag_name ASC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [facet.facet_id, pagination.limit, pagination.offset]
  );
};

/**
 * Get facet information by key from database
 */
exports.getFacetInfo = async function(facetKey) {
  return await this.getTemplateTagFacetByKey(facetKey);
};

/**
 * List all template tag facets from database
 */
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

/**
 * Get template tag facet by key
 */
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
