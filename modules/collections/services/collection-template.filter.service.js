'use strict';

const CollectionTemplateModel = require('../models/collection-template.model');

/**
 * Resolve template IDs that satisfy all facet rules (AND across facets, OR within each facet).
 * Uses a fixed set of simple queries; intersection is done in memory.
 */
async function resolveTemplateIdsForFacetFilters(facetFilters) {
  if (!facetFilters || facetFilters.length === 0) {
    return null;
  }

  const facetKeys = [...new Set(facetFilters.map((f) => f.facet).filter(Boolean))];
  const facets = await CollectionTemplateModel.getFacetsByFacetKeys(facetKeys);
  const facetKeyToId = new Map(facets.map((f) => [f.facet_key, String(f.facet_id)]));

  const facetIds = facets.map((f) => f.facet_id);
  if (!facetIds.length) {
    return [];
  }

  const tagDefinitions = await CollectionTemplateModel.getTagDefinitionsByFacetIds(facetIds);
  const ttdIdsForFilters = new Set();

  facetFilters.forEach((facetFilter) => {
    const facetId = facetKeyToId.get(facetFilter.facet);
    if (!facetId) return;
    const codes = new Set(
      Array.isArray(facetFilter.tagCodes) ? facetFilter.tagCodes : [facetFilter.tagCodes]
    );
    tagDefinitions.forEach((def) => {
      if (String(def.facet_id) === facetId && codes.has(def.tag_code)) {
        ttdIdsForFilters.add(def.ttd_id);
      }
    });
  });

  if (ttdIdsForFilters.size === 0) {
    return [];
  }

  const templateTagRows = await CollectionTemplateModel.getTemplateTagsByTtdIds([...ttdIdsForFilters]);
  const templatesByTtdId = new Map();

  templateTagRows.forEach((row) => {
    const key = String(row.ttd_id);
    if (!templatesByTtdId.has(key)) {
      templatesByTtdId.set(key, new Set());
    }
    templatesByTtdId.get(key).add(row.template_id);
  });

  let intersection = null;

  facetFilters.forEach((facetFilter) => {
    const facetId = facetKeyToId.get(facetFilter.facet);
    const codes = new Set(
      Array.isArray(facetFilter.tagCodes) ? facetFilter.tagCodes : [facetFilter.tagCodes]
    );
    const facetTtdIds = tagDefinitions
      .filter((def) => String(def.facet_id) === facetId && codes.has(def.tag_code))
      .map((def) => String(def.ttd_id));

    const templateIdSet = new Set();
    facetTtdIds.forEach((ttdId) => {
      const ids = templatesByTtdId.get(ttdId);
      if (ids) {
        ids.forEach((templateId) => templateIdSet.add(templateId));
      }
    });

    if (intersection === null) {
      intersection = templateIdSet;
    } else {
      intersection = new Set([...intersection].filter((id) => templateIdSet.has(id)));
    }
  });

  if (!intersection || intersection.size === 0) {
    return [];
  }

  return [...intersection];
}

exports.countTemplatesByRuleFilters = async function(facetFilters, attributeFilters) {
  const templateIds = await resolveTemplateIdsForFacetFilters(facetFilters);
  if (Array.isArray(templateIds) && templateIds.length === 0) {
    return 0;
  }
  return CollectionTemplateModel.countTemplatesByAttributeFilters(templateIds, attributeFilters);
};

exports.getTemplatesByRuleFilters = async function(facetFilters, attributeFilters, pagination) {
  const templateIds = await resolveTemplateIdsForFacetFilters(facetFilters);
  if (Array.isArray(templateIds) && templateIds.length === 0) {
    return [];
  }
  return CollectionTemplateModel.getTemplatesByAttributeFilters(templateIds, attributeFilters, pagination);
};
