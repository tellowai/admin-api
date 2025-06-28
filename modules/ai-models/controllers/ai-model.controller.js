'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AiModelModel = require('../models/ai-model.model');
const AiModelErrorHandler = require('../middlewares/ai-model.error.handler');
const logger = require('../../../config/lib/logger');

/**
 * @api {get} /ai-models List all AI models
 * @apiVersion 1.0.0
 * @apiName ListAiModels
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiDescription Get list of all available AI models with their platform details
 *
 * @apiHeader {String} Authorization JWT token
 * 
 * @apiQuery {String} [input_type] Filter by input type (e.g., "text", "image", "text,image")
 * @apiQuery {String} [input_types] Alternative to input_type (same functionality)
 * @apiQuery {String} [output_type] Filter by output type (e.g., "image", "video", "image,video")
 * @apiQuery {String} [output_types] Alternative to output_type (same functionality)
 */
exports.listAiModels = async function(req, res) {
  try {
    // Parse search parameters (support both singular and plural forms)
    const inputTypeParam = req.query.input_type || req.query.input_types;
    const outputTypeParam = req.query.output_type || req.query.output_types;
    
    const searchParams = {
      input_types: inputTypeParam ? inputTypeParam.split(',').map(type => type.trim()) : null,
      output_types: outputTypeParam ? outputTypeParam.split(',').map(type => type.trim()) : null
    };

    // Get AI models with search filters
    const aiModels = await AiModelModel.listAllAiModels(searchParams);
    
    if (!aiModels.length) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: []
      });
    }

    // Get platform details for each model
    const platformIds = [...new Set(aiModels.map(model => model.amp_platform_id))];
    const platforms = await AiModelModel.getPlatformsByIds(platformIds);
    
    // Create platform lookup map
    const platformMap = platforms.reduce((acc, platform) => {
      acc[platform.amp_platform_id] = platform;
      return acc;
    }, {});

    // Combine model data with platform details
    const modelsWithPlatforms = aiModels.map(model => ({
      ...model,
      platform: platformMap[model.amp_platform_id] || null,
      input_types: model.input_types ? (typeof model.input_types === 'string' ? JSON.parse(model.input_types) : model.input_types) : null,
      output_types: model.output_types ? (typeof model.output_types === 'string' ? JSON.parse(model.output_types) : model.output_types) : null,
      costs: model.costs ? (typeof model.costs === 'string' ? JSON.parse(model.costs) : model.costs) : null
    }));

    // Explicitly re-sort by created_at descending to guarantee order after manipulations
    modelsWithPlatforms.sort((a, b) => {
      const dateComparison = new Date(b.created_at) - new Date(a.created_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      // Fallback to sorting by model_id alphabetically if timestamps are identical
      return a.model_id.localeCompare(b.model_id);
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: modelsWithPlatforms
    });

  } catch (error) {
    logger.error('Error listing AI models:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
}; 

/**
 * @api {post} /ai-models Create a new AI model
 * @apiVersion 1.0.0
 * @apiName CreateAiModel
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiBody {String} model_id Unique identifier for the AI model
 * @apiBody {Number} amp_platform_id Platform ID from ai_model_provider_platforms
 * @apiBody {String} model_name Name of the AI model
 * @apiBody {String} [description] Description of the AI model
 * @apiBody {String} platform_model_id Model ID used by the platform
 * @apiBody {String[]} [input_types] Array of supported input types
 * @apiBody {String[]} [output_types] Array of supported output types
 * @apiBody {String[]} [supported_video_qualities] Array of supported video qualities
 * @apiBody {Object} [costs] Cost information for the model
 * @apiBody {Number} [generation_time_ms] Average generation time in milliseconds
 * @apiBody {String} [status] Status of the model (active, inactive, disabled)
 */
exports.createAiModel = async function(req, res) {
  try {
    const modelData = req.validatedBody;
    const adminId = req.user.userId;

    // Check if model_id already exists
    const modelExists = await AiModelModel.checkModelIdExists(modelData.model_id);
    if (modelExists) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('ai_model:AI_MODEL_ALREADY_EXISTS')
      });
    }

    // Check if platform exists
    const platformExists = await AiModelModel.checkPlatformExists(modelData.amp_platform_id);
    if (!platformExists) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('ai_model:PLATFORM_NOT_FOUND')
      });
    }

    await AiModelModel.createAiModel(modelData);

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      model_id: modelData.model_id,
      message: req.t('ai_model:AI_MODEL_CREATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error creating AI model:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
};

/**
 * @api {patch} /ai-models/:modelId Update AI model
 * @apiVersion 1.0.0
 * @apiName UpdateAiModel
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiParam {String} modelId AI model's unique ID
 * 
 * @apiBody {String} [model_name] Name of the AI model
 * @apiBody {String} [description] Description of the AI model
 * @apiBody {String} [platform_model_id] Model ID used by the platform
 * @apiBody {String[]} [input_types] Array of supported input types
 * @apiBody {String[]} [output_types] Array of supported output types
 * @apiBody {String[]} [supported_video_qualities] Array of supported video qualities
 * @apiBody {Object} [costs] Cost information for the model
 * @apiBody {Number} [generation_time_ms] Average generation time in milliseconds
 * @apiBody {String} [status] Status of the model (active, inactive, disabled)
 */
exports.updateAiModel = async function(req, res) {
  try {
    const modelId = req.params.modelId;
    const updateData = req.validatedBody;

    // Check if model exists
    const modelExists = await AiModelModel.checkModelExists(modelId);
    if (!modelExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model:AI_MODEL_NOT_FOUND')
      });
    }

    // Update model
    await AiModelModel.updateAiModel(modelId, updateData);

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('ai_model:AI_MODEL_UPDATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error updating AI model:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
};

/**
 * @api {get} /ai-models/:modelId Get AI model by ID
 * @apiVersion 1.0.0
 * @apiName GetAiModel
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiParam {String} modelId AI model's unique ID
 */
exports.getAiModel = async function(req, res) {
  try {
    const modelId = req.params.modelId;

    // Get AI model
    const [aiModel] = await AiModelModel.getAiModelById(modelId);
    
    if (!aiModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model:AI_MODEL_NOT_FOUND')
      });
    }

    // Get platform details
    const [platform] = await AiModelModel.getPlatformById(aiModel.amp_platform_id);

    // Parse JSON fields
    const modelWithPlatform = {
      ...aiModel,
      platform: platform || null,
      input_types: aiModel.input_types ? (typeof aiModel.input_types === 'string' ? JSON.parse(aiModel.input_types) : aiModel.input_types) : null,
      output_types: aiModel.output_types ? (typeof aiModel.output_types === 'string' ? JSON.parse(aiModel.output_types) : aiModel.output_types) : null,
      supported_video_qualities: aiModel.supported_video_qualities ? (typeof aiModel.supported_video_qualities === 'string' ? JSON.parse(aiModel.supported_video_qualities) : aiModel.supported_video_qualities) : null,
      costs: aiModel.costs ? (typeof aiModel.costs === 'string' ? JSON.parse(aiModel.costs) : aiModel.costs) : null
    };

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: modelWithPlatform
    });

  } catch (error) {
    logger.error('Error getting AI model:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
};

/**
 * @api {post} /ai-models/platforms Create a new AI model platform
 * @apiVersion 1.0.0
 * @apiName CreatePlatform
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiBody {String} platform_name Name of the platform
 * @apiBody {String} platform_code Unique code for the platform
 * @apiBody {String} [description] Description of the platform
 */
exports.createPlatform = async function(req, res) {
  try {
    const platformData = req.validatedBody;

    await AiModelModel.createPlatform(platformData);

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      platform_code: platformData.platform_code,
      message: req.t('ai_model:PLATFORM_CREATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error creating platform:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
};

/**
 * @api {get} /ai-models/platforms List all AI model platforms
 * @apiVersion 1.0.0
 * @apiName ListPlatforms
 * @apiGroup AiModels
 * @apiPermission JWT
 */
exports.listPlatforms = async function(req, res) {
  try {
    const platforms = await AiModelModel.listAllPlatforms();

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: platforms
    });

  } catch (error) {
    logger.error('Error listing platforms:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
}; 