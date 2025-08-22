'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AiModelModel = require('../models/ai-model.model');
const AiModelErrorHandler = require('../middlewares/ai-model.error.handler');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const config = require('../../../config/config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const AiModelTagModel = require('../models/ai-model.tag.model');

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
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
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

    // Get pagination parameters
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    // Get AI models with search filters and pagination
    const { models: aiModels } = await AiModelModel.listAllAiModels(searchParams, paginationParams);
    
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

    // Generate presigned URLs for platform logos
    const storage = StorageFactory.getProvider();
    await Promise.all(platforms.map(async (platform) => {
      if (platform.platform_logo_key) {
        if (platform.platform_logo_bucket === 'public') {
          platform.platform_logo_url = `${config.os2.r2.public.bucketUrl}/${platform.platform_logo_key}`;
        } else {
          try {
            platform.platform_logo_url = await storage.generatePresignedDownloadUrl(platform.platform_logo_key);
          } catch (err) {
            logger.error('Error generating presigned URL for platform logo:', {
              error: err.message,
              asset_key: platform.platform_logo_key
            });
          }
        }
      }
    }));

    // Combine model data with platform details
    const modelsWithPlatforms = aiModels.map(model => ({
      ...model,
      platform: platformMap[model.amp_platform_id] || null,
      input_types: model.input_types ? (typeof model.input_types === 'string' ? JSON.parse(model.input_types) : model.input_types) : null,
      output_types: model.output_types ? (typeof model.output_types === 'string' ? JSON.parse(model.output_types) : model.output_types) : null,
      costs: model.costs ? (typeof model.costs === 'string' ? JSON.parse(model.costs) : model.costs) : null
    }));

    // Get tags for all models
    const AiModelTagModel = require('../models/ai-model.tag.model');
    
    try {
      // First, get all tag associations for all models
      const allTagAssociations = await Promise.all(
        modelsWithPlatforms.map(async (model) => {
          try {
            const tagAssociations = await AiModelModel.getAiModelTags(model.model_id);
            return { modelId: model.model_id, tagAssociations };
          } catch (err) {
            logger.error('Error fetching tag associations for model:', {
              error: err.message,
              model_id: model.model_id
            });
            return { modelId: model.model_id, tagAssociations: [] };
          }
        })
      );
      
      // Collect all unique tag IDs
      const allTagIds = [...new Set(
        allTagAssociations
          .flatMap(item => item.tagAssociations)
          .map(tag => tag.amtd_id)
          .filter(id => id) // Filter out any null/undefined IDs
      )];
      
      logger.info('Tag fetching info:', {
        total_models: modelsWithPlatforms.length,
        models_with_tags: allTagAssociations.filter(item => item.tagAssociations.length > 0).length,
        unique_tag_ids: allTagIds.length,
        tag_ids: allTagIds
      });
      
      // Fetch all tag definitions in one query
      let allTagDefinitions = [];
      if (allTagIds.length > 0) {
        allTagDefinitions = await AiModelTagModel.getTagDefinitionsByIds(allTagIds);
        logger.info('Tag definitions fetched:', {
          requested_count: allTagIds.length,
          actual_fetched: allTagDefinitions.length
        });
      }
      
      // Create a lookup map for tag definitions
      const tagDefinitionsMap = allTagDefinitions.reduce((acc, tag) => {
        acc[tag.amtd_id] = tag;
        return acc;
      }, {});
      
      // Stitch tags to models
      modelsWithPlatforms.forEach((model) => {
        const modelTagAssociations = allTagAssociations.find(item => item.modelId === model.model_id);
        if (modelTagAssociations && modelTagAssociations.tagAssociations.length > 0) {
          model.tags = modelTagAssociations.tagAssociations
            .map(tag => tagDefinitionsMap[tag.amtd_id])
            .filter(tag => tag); // Filter out any undefined tags
          
          logger.debug('Tags stitched for model:', {
            model_id: model.model_id,
            tag_count: model.tags.length,
            tags: model.tags.map(t => ({ id: t.amtd_id, name: t.tag_name, code: t.tag_code }))
          });
        } else {
          model.tags = [];
        }
      });
      
    } catch (error) {
      logger.error('Error fetching or stitching tags for AI models:', {
        error: error.message,
        stack: error.stack
      });
      // Set empty tags for all models if tag fetching fails
      modelsWithPlatforms.forEach(model => {
        model.tags = [];
      });
    }

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
 * @apiBody {Number[]} [tags] Array of tag definition IDs to associate with the model
 */
exports.createAiModel = async function(req, res) {
  try {
    const modelData = req.validatedBody;
    const adminId = req.user.userId;
    
    // Extract tags from model data
    const tags = modelData.tags || [];
    delete modelData.tags; // Remove tags from model data as it's not a column in ai_models table

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

    // Create the AI model
    await AiModelModel.createAiModel(modelData);

    // Create tag associations if tags are provided
    if (tags.length > 0) {
      for (const tagId of tags) {
        await AiModelModel.createAiModelTag(modelData.model_id, tagId);
      }
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'AI_MODELS',
          action_name: 'CREATE_AI_MODEL', 
          entity_id: modelData.model_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      model_id: modelData.model_id,
      message: req.t('ai_model:AI_MODEL_CREATED_SUCCESSFULLY'),
      tags_added: tags.length
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
 * @apiBody {Number[]} [tags] Array of tag definition IDs to associate with the model
 */
exports.updateAiModel = async function(req, res) {
  try {
    const modelId = req.params.modelId;
    const updateData = req.validatedBody;
    const adminId = req.user.userId;

    logger.info('Update AI model request:', {
      model_id: modelId,
      update_data: updateData,
      has_tags: 'tags' in updateData,
      tags_value: updateData.tags
    });

    // Extract tags from update data
    const tags = updateData.tags;
    delete updateData.tags; // Remove tags from update data as it's not a column in ai_models table

    logger.info('Tags extracted:', {
      tags: tags,
      tags_undefined: tags === undefined,
      tags_null: tags === null,
      tags_length: Array.isArray(tags) ? tags.length : 'not_array'
    });

    // Check if model exists
    const modelExists = await AiModelModel.checkModelExists(modelId);
    if (!modelExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model:AI_MODEL_NOT_FOUND')
      });
    }

    // Update model if there are fields to update
    if (Object.keys(updateData).length > 0) {
      await AiModelModel.updateAiModel(modelId, updateData);
    }

    // Update tags if provided
    let tagUpdateResult = null;
    if (tags !== undefined) {
      logger.info('Updating tags for model:', {
        model_id: modelId,
        tags: tags
      });
      
      tagUpdateResult = await AiModelModel.updateAiModelTags(modelId, tags);
      
      logger.info('Tag update result:', {
        model_id: modelId,
        result: tagUpdateResult
      });
    } else {
      logger.info('No tags provided for update, skipping tag update');
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'AI_MODELS',
          action_name: 'UPDATE_AI_MODEL', 
          entity_id: modelId
        }
      }],
      'create_admin_activity_log'
    );

    const response = {
      message: req.t('ai_model:AI_MODEL_UPDATED_SUCCESSFULLY')
    };

    // Add tag update information if tags were updated
    if (tagUpdateResult) {
      response.tags_added = tagUpdateResult.added.length;
      response.tags_removed = tagUpdateResult.removed.length;
    }

    logger.info('Update AI model response:', {
      model_id: modelId,
      response: response
    });

    return res.status(HTTP_STATUS_CODES.OK).json(response);

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

    // Generate presigned URL for the platform logo
    if (platform && platform.platform_logo_key) {
      const storage = StorageFactory.getProvider();
      if (platform.platform_logo_bucket === 'public') {
        platform.platform_logo_url = `${config.os2.r2.public.bucketUrl}/${platform.platform_logo_key}`;
      } else {
        try {
          platform.platform_logo_url = await storage.generatePresignedDownloadUrl(platform.platform_logo_key);
        } catch (err) {
          logger.error('Error generating presigned URL for platform logo:', {
            error: err.message,
            asset_key: platform.platform_logo_key
          });
        }
      }
    }

    // Get tags for this model
    const tagAssociations = await AiModelModel.getAiModelTags(modelId);
    let tags = [];
    
    if (tagAssociations.length > 0) {
      try {
        const tagIds = tagAssociations.map(tag => tag.amtd_id).filter(id => id);
        if (tagIds.length > 0) {
          tags = await AiModelTagModel.getTagDefinitionsByIds(tagIds);
          
          logger.debug('Tags fetched for model:', {
            model_id: modelId,
            tag_count: tags.length,
            tags: tags.map(t => ({ id: t.amtd_id, name: t.tag_name, code: t.tag_code }))
          });
        }
      } catch (error) {
        logger.error('Error fetching tag definitions for model:', {
          error: error.message,
          model_id: modelId,
          tag_associations: tagAssociations
        });
        tags = [];
      }
    }

    // Parse JSON fields
    const modelWithPlatform = {
      ...aiModel,
      platform: platform || null,
      tags: tags,
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
    const adminId = req.user.userId;

    await AiModelModel.createPlatform(platformData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'AI_MODEL_PLATFORMS',
          action_name: 'CREATE_PLATFORM', 
          entity_id: platformData.platform_code
        }
      }],
      'create_admin_activity_log'
    );

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
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listPlatforms = async function(req, res) {
  try {
    // Get pagination parameters
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    // Get platforms with pagination
    const { platforms: platformsData } = await AiModelModel.listAllPlatforms(paginationParams);

    // Get storage provider for presigned URLs
    if (platformsData.length) {
      const storage = StorageFactory.getProvider();
      
      // Generate presigned URLs for thumbnails
      await Promise.all(platformsData.map(async (platform) => {
        if (platform.platform_logo_key) {
          if (platform.platform_logo_bucket === 'public') {
            platform.platform_logo_url = `${config.os2.r2.public.bucketUrl}/${platform.platform_logo_key}`;
          } else {
            try {
              platform.platform_logo_url = await storage.generatePresignedDownloadUrl(platform.platform_logo_key);
            } catch (err) {
              logger.error('Error generating presigned URL for platform logo:', {
                error: err.message,
                asset_key: platform.platform_logo_key
              });
            }
          }
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: platformsData
    });

  } catch (error) {
    logger.error('Error listing platforms:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
};

/**
 * @api {patch} /ai-models/platforms/:platformId Update an AI model platform
 * @apiVersion 1.0.0
 * @apiName UpdatePlatform
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiParam {Number} platformId The unique ID of the platform
 * @apiBody {String} [platform_name] Name of the platform
 * @apiBody {String} [description] Description of the platform
 * @apiBody {String} [platform_logo_key] The R2 key for the platform logo
 * @apiBody {String} [platform_logo_bucket] The R2 bucket for the platform logo
 */
exports.updatePlatform = async function(req, res) {
  try {
    const platformId = req.params.platformId;
    const updateData = req.validatedBody;
    const adminId = req.user.userId;

    // Check if platform exists
    const [platform] = await AiModelModel.getPlatformById(platformId);
    if (!platform) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ai_model:PLATFORM_NOT_FOUND')
      });
    }

    await AiModelModel.updatePlatform(platformId, updateData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'AI_MODEL_PLATFORMS',
          action_name: 'UPDATE_PLATFORM', 
          entity_id: platformId.toString()
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      platform_id: platformId,
      message: req.t('ai_model:PLATFORM_UPDATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error updating platform:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
}; 

/**
 * @api {get} /ai-models/search Search AI models
 * @apiVersion 1.0.0
 * @apiName SearchAiModels
 * @apiGroup AiModels
 * @apiPermission JWT
 *
 * @apiDescription Search AI models by model name, tag name, or tag code
 *
 * @apiHeader {String} Authorization JWT token
 * @apiQuery {String} [model_name] Search by model name (partial match)
 * @apiQuery {String} [tag_name] Search by tag name (partial match)
 * @apiQuery {String} [tag_code] Search by tag code (partial match)
 * @apiQuery {String} [input_type] Filter by input type (e.g., "text", "image", "text,image")
 * @apiQuery {String} [input_types] Alternative to input_type (same functionality)
 * @apiQuery {String} [output_type] Filter by output type (e.g., "image", "video", "image,video")
 * @apiQuery {String} [output_types] Alternative to output_type (same functionality)
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.searchAiModels = async function(req, res) {
  try {
    // Parse search parameters
    const searchParams = {
      model_name: req.query.model_name || null,
      tag_name: req.query.tag_name || null,
      tag_code: req.query.tag_code || null,
      input_types: req.query.input_type || req.query.input_types ? 
        (req.query.input_type || req.query.input_types).split(',').map(type => type.trim()) : null,
      output_types: req.query.output_type || req.query.output_types ? 
        (req.query.output_type || req.query.output_types).split(',').map(type => type.trim()) : null
    };

    // Get pagination parameters
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);

    let aiModels = [];

    // If searching by tag name or tag code, use tag-based search
    if (searchParams.tag_name || searchParams.tag_code) {
      // Search for tag definitions first
      const tagSearchParams = {
        tag_name: searchParams.tag_name,
        tag_code: searchParams.tag_code
      };
      
      const tagDefinitions = await AiModelTagModel.searchTagDefinitions(tagSearchParams);
      
      if (tagDefinitions.length > 0) {
        // Get tag IDs from the search results
        const tagIds = tagDefinitions.map(tag => tag.amtd_id);
        
        // Search for AI models that have these tags
        const result = await AiModelModel.searchAiModelsByTagIds(tagIds, paginationParams);
        aiModels = result.models;
        
        logger.info('Tag-based search results:', {
          tag_search_params: tagSearchParams,
          tags_found: tagDefinitions.length,
          tag_ids: tagIds,
          models_found: aiModels.length
        });
      }
    } else {
      // Direct search in AI models table
      const result = await AiModelModel.searchAiModels(searchParams, paginationParams);
      aiModels = result.models;
      
      logger.info('Direct search results:', {
        search_params: searchParams,
        models_found: aiModels.length
      });
    }

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

    // Generate presigned URLs for platform logos
    const storage = StorageFactory.getProvider();
    await Promise.all(platforms.map(async (platform) => {
      if (platform.platform_logo_key) {
        if (platform.platform_logo_bucket === 'public') {
          platform.platform_logo_url = `${config.os2.r2.public.bucketUrl}/${platform.platform_logo_key}`;
        } else {
          try {
            platform.platform_logo_url = await storage.generatePresignedDownloadUrl(platform.platform_logo_key);
          } catch (err) {
            logger.error('Error generating presigned URL for platform logo:', {
              error: err.message,
              asset_key: platform.platform_logo_key
            });
          }
        }
      }
    }));

    // Combine model data with platform details
    const modelsWithPlatforms = aiModels.map(model => ({
      ...model,
      platform: platformMap[model.amp_platform_id] || null,
      input_types: model.input_types ? (typeof model.input_types === 'string' ? JSON.parse(model.input_types) : model.input_types) : null,
      output_types: model.output_types ? (typeof model.output_types === 'string' ? JSON.parse(model.output_types) : model.output_types) : null,
      costs: model.costs ? (typeof model.costs === 'string' ? JSON.parse(model.costs) : model.costs) : null
    }));

    // Get tags for all models
    try {
      // First, get all tag associations for all models
      const allTagAssociations = await Promise.all(
        modelsWithPlatforms.map(async (model) => {
          try {
            const tagAssociations = await AiModelModel.getAiModelTags(model.model_id);
            return { modelId: model.model_id, tagAssociations };
          } catch (err) {
            logger.error('Error fetching tag associations for model:', {
              error: err.message,
              model_id: model.model_id
            });
            return { modelId: model.model_id, tagAssociations: [] };
          }
        })
      );
      
      // Collect all unique tag IDs
      const allTagIds = [...new Set(
        allTagAssociations
          .flatMap(item => item.tagAssociations)
          .map(tag => tag.amtd_id)
          .filter(id => id)
      )];
      
      // Fetch all tag definitions in one query
      let allTagDefinitions = [];
      if (allTagIds.length > 0) {
        allTagDefinitions = await AiModelTagModel.getTagDefinitionsByIds(allTagIds);
      }
      
      // Create a lookup map for tag definitions
      const tagDefinitionsMap = allTagDefinitions.reduce((acc, tag) => {
        acc[tag.amtd_id] = tag;
        return acc;
      }, {});
      
      // Stitch tags to models
      modelsWithPlatforms.forEach((model) => {
        const modelTagAssociations = allTagAssociations.find(item => item.modelId === model.model_id);
        if (modelTagAssociations && modelTagAssociations.tagAssociations.length > 0) {
          model.tags = modelTagAssociations.tagAssociations
            .map(tag => tagDefinitionsMap[tag.amtd_id])
            .filter(tag => tag);
        } else {
          model.tags = [];
        }
      });
      
    } catch (error) {
      logger.error('Error fetching or stitching tags for AI models:', {
        error: error.message,
        stack: error.stack
      });
      // Set empty tags for all models if tag fetching fails
      modelsWithPlatforms.forEach(model => {
        model.tags = [];
      });
    }

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
    logger.error('Error searching AI models:', { error: error.message, stack: error.stack });
    AiModelErrorHandler.handleAiModelErrors(error, res);
  }
}; 