'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateTagDefinitionModel = require('../models/template.tag.definition.model');
const TemplateTagFacetModel = require('../models/template.tag.facet.model');
const TemplateTagErrorHandler = require('../middlewares/template.tag.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {get} /template-tags List template tag definitions
 * @apiVersion 1.0.0
 * @apiName ListTemplateTagDefinitions
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listTemplateTagDefinitions = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const tagDefinitions = await TemplateTagDefinitionModel.listTemplateTagDefinitionsWithPagination(paginationParams);

    // Stitch facet information for each tag definition
    if (tagDefinitions.length > 0) {
      const facetIds = [...new Set(tagDefinitions.map(tag => tag.facet_id))];
      const facets = await TemplateTagFacetModel.getTemplateTagFacetsByIds(facetIds);
      
      // Create a map for quick lookup
      const facetMap = new Map();
      facets.forEach(facet => {
        facetMap.set(facet.facet_id, facet);
      });

      // Stitch the data together
      tagDefinitions.forEach(tag => {
        const facet = facetMap.get(tag.facet_id);
        if (facet) {
          tag.facet_key = facet.facet_key;
          tag.facet_display_name = facet.display_name;
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: tagDefinitions
    });

  } catch (error) {
    logger.error('Error listing template tag definitions:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {post} /template-tags Create template tag definition
 * @apiVersion 1.0.0
 * @apiName CreateTemplateTagDefinition
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiBody {String} tag_name Tag name
 * @apiBody {String} tag_code Unique tag code
 * @apiBody {String} [tag_description] Tag description
 * @apiBody {Number} facet_id Facet ID (required)
 * @apiBody {Boolean} [is_active=true] Whether tag is active
 */
exports.createTemplateTagDefinition = async function(req, res) {
  try {
    const tagData = req.validatedBody;

    // Check if tag code already exists
    const existingTag = await TemplateTagDefinitionModel.getTemplateTagDefinitionByCode(tagData.tag_code);
    if (existingTag) {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        message: req.t('template_tag:TAG_CODE_EXISTS')
      });
    }

    // Validate that facet_id exists
    const facetExists = await TemplateTagFacetModel.checkTemplateTagFacetExists(tagData.facet_id);
    if (!facetExists) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('template_tag:INVALID_FACET_ID')
      });
    }

    const createdTag = await TemplateTagDefinitionModel.createTemplateTagDefinition(tagData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATE_TAGS',
          action_name: 'ADD_NEW_TEMPLATE_TAG', 
          entity_id: createdTag.ttd_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('template_tag:TEMPLATE_TAG_CREATED'),
      data: createdTag
    });

  } catch (error) {
    logger.error('Error creating template tag definition:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {get} /template-tags/:tagId Get template tag definition by ID
 * @apiVersion 1.0.0
 * @apiName GetTemplateTagDefinitionById
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiParam {String} tagId Template tag definition ID
 */
exports.getTemplateTagDefinitionById = async function(req, res) {
  try {
    const { tagId } = req.params;
    
    const tagDefinition = await TemplateTagDefinitionModel.getTemplateTagDefinitionById(tagId);
    
    if (!tagDefinition) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:TEMPLATE_TAG_NOT_FOUND')
      });
    }

    // Stitch facet information
    const facet = await TemplateTagFacetModel.getTemplateTagFacetById(tagDefinition.facet_id);
    if (facet) {
      tagDefinition.facet_key = facet.facet_key;
      tagDefinition.facet_display_name = facet.display_name;
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: tagDefinition
    });

  } catch (error) {
    logger.error('Error getting template tag definition by ID:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {patch} /template-tags/:tagId Update template tag definition
 * @apiVersion 1.0.0
 * @apiName UpdateTemplateTagDefinition
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiParam {String} tagId Template tag definition ID
 * @apiBody {String} [tag_name] Tag name
 * @apiBody {String} [tag_code] Unique tag code
 * @apiBody {String} [tag_description] Tag description
 * @apiBody {Number} [facet_id] Facet ID
 * @apiBody {Boolean} [is_active] Whether tag is active
 */
exports.updateTemplateTagDefinition = async function(req, res) {
  try {
    const { tagId } = req.params;
    const tagData = req.validatedBody;

    // Check if tag definition exists
    const existingTag = await TemplateTagDefinitionModel.getTemplateTagDefinitionById(tagId);
    if (!existingTag) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:TEMPLATE_TAG_NOT_FOUND')
      });
    }

    // Check if tag code already exists (if being updated)
    if (tagData.tag_code && tagData.tag_code !== existingTag.tag_code) {
      const codeExists = await TemplateTagDefinitionModel.getTemplateTagDefinitionByCode(tagData.tag_code);
      if (codeExists) {
        return res.status(HTTP_STATUS_CODES.CONFLICT).json({
          message: req.t('template_tag:TAG_CODE_EXISTS')
        });
      }
    }

    // Validate that facet_id exists (if being updated)
    if (tagData.facet_id && tagData.facet_id !== existingTag.facet_id) {
      const facetExists = await TemplateTagFacetModel.checkTemplateTagFacetExists(tagData.facet_id);
      if (!facetExists) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('template_tag:INVALID_FACET_ID')
        });
      }
    }

    const updated = await TemplateTagDefinitionModel.updateTemplateTagDefinition(tagId, tagData);
    
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:TEMPLATE_TAG_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATE_TAGS',
          action_name: 'UPDATE_TEMPLATE_TAG', 
          entity_id: tagId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template_tag:TEMPLATE_TAG_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating template tag definition:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {post} /template-tags/:tagId/archive Archive template tag definition
 * @apiVersion 1.0.0
 * @apiName ArchiveTemplateTagDefinition
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiParam {String} tagId Template tag definition ID
 */
exports.archiveTemplateTagDefinition = async function(req, res) {
  try {
    const { tagId } = req.params;
    
    const archived = await TemplateTagDefinitionModel.archiveTemplateTagDefinition(tagId);
    
    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:TEMPLATE_TAG_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATE_TAGS',
          action_name: 'ARCHIVE_TEMPLATE_TAG', 
          entity_id: tagId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template_tag:TEMPLATE_TAG_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving template tag definition:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {get} /template-tags/search Search template tag definitions
 * @apiVersion 1.0.0
 * @apiName SearchTemplateTagDefinitions
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiQuery {String} q Search query
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.searchTemplateTagDefinitions = async function(req, res) {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('template_tag:SEARCH_QUERY_REQUIRED')
      });
    }

    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const tagDefinitions = await TemplateTagDefinitionModel.searchTemplateTagDefinitions(q, paginationParams);

    // Stitch facet information for each tag definition
    if (tagDefinitions.length > 0) {
      const facetIds = [...new Set(tagDefinitions.map(tag => tag.facet_id))];
      const facets = await TemplateTagFacetModel.getTemplateTagFacetsByIds(facetIds);
      
      // Create a map for quick lookup
      const facetMap = new Map();
      facets.forEach(facet => {
        facetMap.set(facet.facet_id, facet);
      });

      // Stitch the data together
      tagDefinitions.forEach(tag => {
        const facet = facetMap.get(tag.facet_id);
        if (facet) {
          tag.facet_key = facet.facet_key;
          tag.facet_display_name = facet.display_name;
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: tagDefinitions
    });

  } catch (error) {
    logger.error('Error searching template tag definitions:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {post} /template-tags/archive/bulk Bulk archive template tag definitions
 * @apiVersion 1.0.0
 * @apiName BulkArchiveTemplateTagDefinitions
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiBody {String[]} tag_ids Array of tag definition IDs (min: 1, max: 50)
 */
exports.bulkArchiveTemplateTagDefinitions = async function(req, res) {
  try {
    const { tag_ids } = req.validatedBody;
    
    const archivedCount = await TemplateTagDefinitionModel.bulkArchiveTemplateTagDefinitions(tag_ids);
    
    if (archivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:NO_TEMPLATE_TAGS_ARCHIVED')
      });
    }

    // Publish activity log command for each archived tag
    const activityLogCommands = tag_ids.map(tagId => ({
      value: { 
        admin_user_id: req.user.userId,
        entity_type: 'TEMPLATE_TAGS',
        action_name: 'BULK_ARCHIVE_TEMPLATE_TAG', 
        entity_id: tagId
      }
    }));

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      activityLogCommands,
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template_tag:TEMPLATE_TAGS_BULK_ARCHIVED'),
      data: {
        archived_count: archivedCount,
        total_requested: tag_ids.length
      }
    });

  } catch (error) {
    logger.error('Error bulk archiving template tag definitions:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};

/**
 * @api {post} /template-tags/unarchive/bulk Bulk unarchive template tag definitions
 * @apiVersion 1.0.0
 * @apiName BulkUnarchiveTemplateTagDefinitions
 * @apiGroup TemplateTags
 * @apiPermission JWT
 *
 * @apiBody {String[]} tag_ids Array of tag definition IDs (min: 1, max: 50)
 */
exports.bulkUnarchiveTemplateTagDefinitions = async function(req, res) {
  try {
    const { tag_ids } = req.validatedBody;
    
    const unarchivedCount = await TemplateTagDefinitionModel.bulkUnarchiveTemplateTagDefinitions(tag_ids);
    
    if (unarchivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template_tag:NO_TEMPLATE_TAGS_UNARCHIVED')
      });
    }

    // Publish activity log command for each unarchived tag
    const activityLogCommands = tag_ids.map(tagId => ({
      value: { 
        admin_user_id: req.user.userId,
        entity_type: 'TEMPLATE_TAGS',
        action_name: 'BULK_UNARCHIVE_TEMPLATE_TAG', 
        entity_id: tagId
      }
    }));

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      activityLogCommands,
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template_tag:TEMPLATE_TAGS_BULK_UNARCHIVED'),
      data: {
        unarchived_count: unarchivedCount,
        total_requested: tag_ids.length
      }
    });

  } catch (error) {
    logger.error('Error bulk unarchiving template tag definitions:', { error: error.message, stack: error.stack });
    TemplateTagErrorHandler.handleTemplateTagErrors(error, res);
  }
};
