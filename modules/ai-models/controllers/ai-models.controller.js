'use strict';

const aiModelsModel = require('../models/ai-models.model');
const platformsModel = require('../../platforms/models/platforms.model');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * Get all AI models
 */
exports.getAllModels = async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const models = includeArchived ? 
      await aiModelsModel.getAllModelsWithArchived() : 
      await aiModelsModel.getAllModels();
    
    // Parse JSON fields
    const parsedModels = models.map(model => ({
      ...model,
      parameters: model.parameters ? JSON.parse(model.parameters) : {},
      inputs: model.inputs ? JSON.parse(model.inputs) : []
    }));
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: parsedModels
    });
  } catch (error) {
    console.error('Error fetching AI models:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching AI models',
      error: error.message
    });
  }
};

/**
 * Get AI models by platform ID
 */
exports.getModelsByPlatformId = async (req, res) => {
  try {
    const platformId = req.params.platformId;
    
    if (!platformId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform ID is required'
      });
    }
    
    const models = await aiModelsModel.getModelsByPlatformId(platformId);
    
    // Parse JSON fields
    const parsedModels = models.map(model => ({
      ...model,
      parameters: model.parameters ? JSON.parse(model.parameters) : {},
      inputs: model.inputs ? JSON.parse(model.inputs) : []
    }));
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: parsedModels
    });
  } catch (error) {
    console.error('Error fetching AI models by platform ID:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching AI models',
      error: error.message
    });
  }
};

/**
 * Get a single AI model by ID
 */
exports.getModelById = async (req, res) => {
  try {
    const modelId = req.params.modelId;
    
    if (!modelId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }
    
    const model = await aiModelsModel.getModelById(modelId);
    
    if (!model) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    // Parse JSON fields
    const parsedModel = {
      ...model,
      parameters: model.parameters ? JSON.parse(model.parameters) : {},
      inputs: model.inputs ? JSON.parse(model.inputs) : []
    };
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: parsedModel
    });
  } catch (error) {
    console.error('Error fetching AI model by ID:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching AI model',
      error: error.message
    });
  }
};

/**
 * Get a single AI model by slug
 */
exports.getModelBySlug = async (req, res) => {
  try {
    const slug = req.params.slug;
    
    if (!slug) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model slug is required'
      });
    }
    
    const model = await aiModelsModel.getModelBySlug(slug);
    
    if (!model) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    // Parse JSON fields
    const parsedModel = {
      ...model,
      parameters: model.parameters ? JSON.parse(model.parameters) : {},
      inputs: model.inputs ? JSON.parse(model.inputs) : []
    };
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: parsedModel
    });
  } catch (error) {
    console.error('Error fetching AI model by slug:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching AI model',
      error: error.message
    });
  }
};

/**
 * Create a new AI model
 */
exports.createModel = async (req, res) => {
  try {
    const modelData = req.body;
    
    // Validate required fields
    if (!modelData.model_id || !modelData.platform_id || !modelData.name || !modelData.slug || !modelData.platform_model_id) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'model_id, platform_id, name, slug, and platform_model_id are required fields'
      });
    }
    
    // Check if platform exists
    const platform = await platformsModel.getPlatformById(modelData.platform_id);
    if (!platform) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform not found'
      });
    }
    
    // Check if model_id already exists
    const existingModelById = await aiModelsModel.getModelById(modelData.model_id);
    if (existingModelById) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'An AI model with this model_id already exists'
      });
    }
    
    // Check if slug already exists
    const existingModelBySlug = await aiModelsModel.getModelBySlug(modelData.slug);
    if (existingModelBySlug) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'An AI model with this slug already exists'
      });
    }
    
    // Check if platform_model_id already exists for this platform
    const platformModelIdExists = await aiModelsModel.checkPlatformModelIdExists(
      modelData.platform_id, 
      modelData.platform_model_id
    );
    if (platformModelIdExists) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'A model with this platform_model_id already exists for this platform'
      });
    }
    
    const result = await aiModelsModel.createModel(modelData);
    
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: 'AI model created successfully',
      data: {
        model_id: modelData.model_id,
        ...result
      }
    });
  } catch (error) {
    console.error('Error creating AI model:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while creating AI model',
      error: error.message
    });
  }
};

/**
 * Update an AI model
 */
exports.updateModel = async (req, res) => {
  try {
    const modelId = req.params.modelId;
    const modelData = req.body;
    
    if (!modelId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }
    
    // Check if model exists
    const existingModel = await aiModelsModel.getModelById(modelId);
    if (!existingModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    // If platform_id is being updated, check if platform exists
    if (modelData.platform_id && modelData.platform_id !== existingModel.platform_id) {
      const platform = await platformsModel.getPlatformById(modelData.platform_id);
      if (!platform) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Platform not found'
        });
      }
    }
    
    // If slug is being updated, check if it already exists
    if (modelData.slug && modelData.slug !== existingModel.slug) {
      const existingModelBySlug = await aiModelsModel.getModelBySlug(modelData.slug);
      if (existingModelBySlug) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'An AI model with this slug already exists'
        });
      }
    }
    
    // If platform_model_id or platform_id is being updated, check uniqueness
    if ((modelData.platform_model_id && modelData.platform_model_id !== existingModel.platform_model_id) ||
        (modelData.platform_id && modelData.platform_id !== existingModel.platform_id)) {
      
      const checkPlatformId = modelData.platform_id || existingModel.platform_id;
      const checkPlatformModelId = modelData.platform_model_id || existingModel.platform_model_id;
      
      const platformModelIdExists = await aiModelsModel.checkPlatformModelIdExists(
        checkPlatformId, 
        checkPlatformModelId,
        modelId
      );
      
      if (platformModelIdExists) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'A model with this platform_model_id already exists for this platform'
        });
      }
    }
    
    const result = await aiModelsModel.updateModel(modelId, modelData);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'AI model updated successfully',
      data: {
        model_id: modelId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error updating AI model:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while updating AI model',
      error: error.message
    });
  }
};

/**
 * Archive an AI model
 */
exports.archiveModel = async (req, res) => {
  try {
    const modelId = req.params.modelId;
    
    if (!modelId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }
    
    // Check if model exists
    const existingModel = await aiModelsModel.getModelById(modelId);
    if (!existingModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    const result = await aiModelsModel.archiveModel(modelId);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'AI model archived successfully',
      data: {
        model_id: modelId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error archiving AI model:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while archiving AI model',
      error: error.message
    });
  }
};

/**
 * Unarchive an AI model
 */
exports.unarchiveModel = async (req, res) => {
  try {
    const modelId = req.params.modelId;
    
    if (!modelId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }
    
    // Check if model exists
    const existingModel = await aiModelsModel.getModelById(modelId);
    if (!existingModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    const result = await aiModelsModel.unarchiveModel(modelId);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'AI model unarchived successfully',
      data: {
        model_id: modelId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error unarchiving AI model:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while unarchiving AI model',
      error: error.message
    });
  }
};

/**
 * Delete an AI model
 */
exports.deleteModel = async (req, res) => {
  try {
    const modelId = req.params.modelId;
    
    if (!modelId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }
    
    // Check if model exists
    const existingModel = await aiModelsModel.getModelById(modelId);
    if (!existingModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }
    
    const result = await aiModelsModel.deleteModel(modelId);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'AI model deleted successfully',
      data: {
        model_id: modelId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error deleting AI model:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while deleting AI model',
      error: error.message
    });
  }
}; 