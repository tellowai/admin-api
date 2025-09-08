'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateFacetModel = require('../models/template.facet.model');
const TemplateTagErrorHandler = require('../middlewares/template.tag.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');

/**
 * @api {get} /template-facets List all facets with their tags
 * @apiVersion 1.0.0
 * @apiName ListTemplateFacetsWithTags
 * @apiGroup TemplateFacets
 * @apiPermission JWT
 *
 * @apiDescription Returns all available facets (categories) with their associated tags
 */
exports.listTemplateFacetsWithTags = async function(req, res) {
  try {
    const facetsWithTags = await TemplateFacetModel.listAllTemplateFacetsWithTags();

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: facetsWithTags
    });

  } catch (error) {
    logger.error('Error listing template facets with tags:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {get} /template-facets/:facetName/tags List tags for a specific facet
 * @apiVersion 1.0.0
 * @apiName ListTemplateFacetTags
 * @apiGroup TemplateFacets
 * @apiPermission JWT
 *
 * @apiParam {String} facetName Facet name (e.g., 'aspect_ratio', 'orientation', 'asset_type')
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listTemplateFacetTags = async function(req, res) {
  try {
    const { facetKey } = req.params;
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    // Validate that facet exists
    const facet = await TemplateFacetModel.getTemplateTagFacetByKey(facetKey);
    if (!facet) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('template_facet:INVALID_FACET_NAME')
      });
    }

    const facetTags = await TemplateFacetModel.listTemplateFacetTags(facetKey, paginationParams);

    // Add facet information to each tag (since we're not using JOINs)
    facetTags.forEach(tag => {
      tag.facet_key = facet.facet_key;
      tag.facet_display_name = facet.display_name;
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        facet_id: facet.facet_id,
        facet_key: facet.facet_key,
        facet_name: facet.facet_key, // For backward compatibility
        facet_display_name: facet.display_name,
        tags: facetTags
      }
    });

  } catch (error) {
    logger.error('Error listing template facet tags:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};
