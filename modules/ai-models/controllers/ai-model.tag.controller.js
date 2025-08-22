'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AiModelTagModel = require('../models/ai-model.tag.model');
const AiModelTagErrorHandler = require('../middlewares/ai-model.tag.error.handler');
const logger = require('../../../config/lib/logger');
const PaginationCtrl = require('../../core/controllers/pagination.controller');

/**
 * @api {get} /ai-model-tags List all AI model tags
 * @apiVersion 1.0.0
 * @apiName ListAiModelTags
 * @apiGroup AiModelTags
 * @apiPermission JWT
 *
 * @apiDescription Get list of all available AI model tags
 *
 * @apiHeader {String} Authorization JWT token
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listAiModelTags = async function(req, res) {
  try {
    // Get pagination parameters
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    // Get AI model tags with pagination (no search filters)
    const { tags: aiModelTags } = await AiModelTagModel.searchAiModelTags({}, paginationParams);
    
    if (!aiModelTags.length) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: []
      });
    }

    // Sort by created_at descending
    aiModelTags.sort((a, b) => {
      const dateComparison = new Date(b.created_at) - new Date(a.created_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      // Fallback to sorting by tag_name alphabetically if timestamps are identical
      return a.tag_name.localeCompare(b.tag_name);
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: aiModelTags
    });

  } catch (error) {
    logger.error('Error listing AI model tags:', {
      error: error.message,
      stack: error.stack
    });
    return AiModelTagErrorHandler.handleAiModelTagListErrors(error, res);
  }
};

/**
 * @api {post} /ai-model-tags Create new AI model tag
 * @apiVersion 1.0.0
 * @apiName CreateAiModelTag
 * @apiGroup AiModelTags
 * @apiPermission JWT
 *
 * @apiDescription Create a new AI model tag
 *
 * @apiHeader {String} Authorization JWT token
 * @apiBody {String} tag_name Tag name
 * @apiBody {String} tag_code Tag code
 * @apiBody {String} [tag_description] Tag description
 */
exports.createAiModelTag = async function(req, res) {
  try {
    const tagData = req.validatedBody;
    
    // Check if tag with same code already exists
    const existingTag = await AiModelTagModel.getAiModelTagByCode(tagData.tag_code);
    if (existingTag) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('ai_model_tag:TAG_CODE_ALREADY_EXISTS')
      });
    }

    const newTag = await AiModelTagModel.createAiModelTag(tagData);
    
    logger.info('AI model tag created successfully:', {
      tag_id: newTag.amtd_id,
      tag_code: newTag.tag_code,
      tag_name: newTag.tag_name
    });

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('ai_model_tag:TAG_CREATED_SUCCESSFULLY'),
      data: newTag
    });

  } catch (error) {
    logger.error('Error creating AI model tag:', {
      error: error.message,
      stack: error.stack,
      tag_data: req.validatedBody
    });
    return AiModelTagErrorHandler.handleAiModelTagCreateErrors(error, res);
  }
};

/**
 * @api {patch} /ai-model-tags/:tagId Update AI model tag
 * @apiVersion 1.0.0
 * @apiName UpdateAiModelTag
 * @apiGroup AiModelTags
 * @apiPermission JWT
 *
 * @apiDescription Update an existing AI model tag
 *
 * @apiHeader {String} Authorization JWT token
 * @apiParam {Number} tagId Tag ID
 * @apiBody {String} [tag_name] Tag name
 * @apiBody {String} [tag_code] Tag code
 * @apiBody {String} [tag_description] Tag description
 */
exports.updateAiModelTag = async function(req, res) {
  try {
    const tagId = req.params.tagId;
    const updateData = req.validatedBody;
    
    // Check if tag exists
    const existingTag = await AiModelTagModel.getAiModelTagById(tagId);
    if (!existingTag) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model_tag:TAG_NOT_FOUND')
      });
    }

    // If tag_code is being updated, check for duplicates
    if (updateData.tag_code && updateData.tag_code !== existingTag.tag_code) {
      const duplicateTag = await AiModelTagModel.getAiModelTagByCode(updateData.tag_code);
      if (duplicateTag) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('ai_model_tag:TAG_CODE_ALREADY_EXISTS')
        });
      }
    }

    const updatedTag = await AiModelTagModel.updateAiModelTag(tagId, updateData);
    
    logger.info('AI model tag updated successfully:', {
      tag_id: tagId,
      tag_code: updatedTag.tag_code,
      tag_name: updatedTag.tag_name
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('ai_model_tag:TAG_UPDATED_SUCCESSFULLY'),
      data: updatedTag
    });

  } catch (error) {
    logger.error('Error updating AI model tag:', {
      error: error.message,
      stack: error.stack,
      tag_id: req.params.tagId,
      update_data: req.validatedBody
    });
    return AiModelTagErrorHandler.handleAiModelTagUpdateErrors(error, res);
  }
};

/**
 * @api {get} /ai-model-tags/:tagId Get AI model tag
 * @apiVersion 1.0.0
 * @apiName GetAiModelTag
 * @apiGroup AiModelTags
 * @apiPermission JWT
 *
 * @apiDescription Get AI model tag by ID
 *
 * @apiHeader {String} Authorization JWT token
 * @apiParam {Number} tagId Tag ID
 */
exports.getAiModelTag = async function(req, res) {
  try {
    const tagId = req.params.tagId;
    
    const aiModelTag = await AiModelTagModel.getAiModelTagById(tagId);
    
    if (!aiModelTag) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model_tag:TAG_NOT_FOUND')
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: aiModelTag
    });

  } catch (error) {
    logger.error('Error getting AI model tag:', {
      error: error.message,
      stack: error.stack,
      tag_id: req.params.tagId
    });
    return AiModelTagErrorHandler.handleAiModelTagErrors(error, res);
  }
};

/**
 * @api {get} /ai-model-tags/search Search AI model tags
 * @apiVersion 1.0.0
 * @apiName SearchAiModelTags
 * @apiGroup AiModelTags
 * @apiPermission JWT
 *
 * @apiDescription Search AI model tags with pagination support
 *
 * @apiHeader {String} Authorization JWT token
 * @apiQuery {String} [tag_names] Comma-separated tag names to search for (partial match)
 * @apiQuery {String} [tag_codes] Comma-separated tag codes to search for (partial match)
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.searchAiModelTags = async function(req, res) {
  try {
    // Parse search parameters
    const searchParams = {
      tag_names: req.query.tag_names ? req.query.tag_names.split(',').map(name => name.trim()).filter(name => name) : null,
      tag_codes: req.query.tag_codes ? req.query.tag_codes.split(',').map(code => code.trim()).filter(code => code) : null
    };

    // Get pagination parameters
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    // Search AI model tags with pagination
    const { tags: aiModelTags } = await AiModelTagModel.searchAiModelTags(searchParams, paginationParams);
    
    if (!aiModelTags.length) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: []
      });
    }

    // Sort by created_at descending
    aiModelTags.sort((a, b) => {
      const dateComparison = new Date(b.created_at) - new Date(a.created_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      // Fallback to sorting by tag_name alphabetically if timestamps are identical
      return a.tag_name.localeCompare(b.tag_name);
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: aiModelTags
    });

  } catch (error) {
    logger.error('Error searching AI model tags:', {
      error: error.message,
      stack: error.stack,
      search_params: req.query
    });
    return AiModelTagErrorHandler.handleAiModelTagListErrors(error, res);
  }
};
