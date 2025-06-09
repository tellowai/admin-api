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

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: modelsWithPlatforms
    });

  } catch (error) {
    logger.error('Error listing AI models:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
}; 