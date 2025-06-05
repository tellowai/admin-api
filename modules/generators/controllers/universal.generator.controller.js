'use strict';

const aiModelsModel = require('../../ai-models/models/ai-models.model');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const FalProvider = require('../../ai-services/providers/fal/fal.provider');
const ReplicateProvider = require('../../ai-services/providers/replicate/replicate.provider');
const config = require('../../../config/config');

/**
 * Generate content using any AI model
 */
exports.generateContent = async (req, res) => {
  try {
    const { model_id } = req.params;
    const inputData = req.body;

    if (!model_id) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Model ID is required'
      });
    }

    // Get model configuration from database
    const model = await aiModelsModel.getModelById(model_id);
    
    if (!model) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'AI model not found'
      });
    }

    if (!model.is_active || model.is_archived) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'AI model is not active or has been archived'
      });
    }

    // Parse model configuration
    const modelInputs = typeof model.inputs === 'string' ? JSON.parse(model.inputs || '[]') : model.inputs;
    const modelParameters = typeof model.parameters === 'string' ? JSON.parse(model.parameters || '{}') : model.parameters;

    // Validate required inputs
    const validationError = validateInputs(inputData, modelInputs);
    if (validationError) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: validationError
      });
    }

    // Route to appropriate platform
    let result;
    const platformName = model.platform_name.toLowerCase();
    
    switch (platformName) {
      case 'fal':
        result = await generateWithFal(model, inputData, modelParameters);
        break;
      case 'replicate':
        result = await generateWithReplicate(model, inputData, modelParameters);
        break;
      default:
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: `Platform ${model.platform_name} is not supported yet`
        });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'Generation request submitted successfully',
      data: {
        request_id: result.request_id,
        status: result.status,
        platform: result.platform,
        model_id: model_id,
        model_name: model.name,
        platform_name: model.platform_name,
        platform_model_id: model.platform_model_id
      }
    });

  } catch (error) {
    console.error('Error in content generation:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error during content generation',
      error: error.message
    });
  }
};

/**
 * Get generation status
 */
exports.getGenerationStatus = async (req, res) => {
  try {
    const { request_id } = req.params;
    const { model_id, platform } = req.query;

    if (!request_id) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Request ID is required'
      });
    }

    if (!platform) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform parameter is required'
      });
    }

    let status;
    let platformModelId;
    
    // Get model info if model_id is provided
    if (model_id) {
      const model = await aiModelsModel.getModelById(model_id);
      if (model) {
        platformModelId = model.platform_model_id;
      }
    }
    
    // Check status with the appropriate platform
    switch (platform.toLowerCase()) {
      case 'fal':
        status = await getStatusFromFal(platformModelId, request_id);
        break;
      case 'replicate':
        status = await getStatusFromReplicate(request_id);
        break;
      default:
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: `Platform ${platform} is not supported`
        });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        request_id,
        status: status.status,
        logs: status.logs || [],
        progress: status.progress,
        updated_at: new Date()
      }
    });

  } catch (error) {
    console.error('Error checking generation status:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while checking generation status',
      error: error.message
    });
  }
};

/**
 * Get generation result
 */
exports.getGenerationResult = async (req, res) => {
  try {
    const { request_id } = req.params;
    const { model_id, platform } = req.query;

    if (!request_id) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Request ID is required'
      });
    }

    if (!platform) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform parameter is required'
      });
    }

    let result;
    let platformModelId;
    
    // Get model info if model_id is provided
    if (model_id) {
      const model = await aiModelsModel.getModelById(model_id);
      if (model) {
        platformModelId = model.platform_model_id;
      }
    }
    
    // Get result from the appropriate platform
    switch (platform.toLowerCase()) {
      case 'fal':
        result = await getResultFromFal(platformModelId, request_id);
        break;
      case 'replicate':
        result = await getResultFromReplicate(request_id);
        break;
      default:
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: `Platform ${platform} is not supported`
        });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        request_id,
        status: result.status,
        data: result.data,
        completed_at: new Date()
      }
    });

  } catch (error) {
    console.error('Error getting generation result:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while getting generation result',
      error: error.message
    });
  }
};

/**
 * Get all generation requests for debugging/monitoring
 * This function is no longer needed but kept as a stub for API compatibility
 */
exports.getAllGenerationRequests = async (req, res) => {
  return res.status(HTTP_STATUS_CODES.OK).json({
    message: 'Generation requests tracking has been disabled',
    data: []
  });
};

// Helper functions

/**
 * Validate inputs against model requirements
 */
function validateInputs(inputData, modelInputs) {
  // If modelInputs is not an object, return null (no validation)
  if (!modelInputs) return null;
  
  // Handle different formats of modelInputs
  const inputs = modelInputs.inputs || modelInputs;
  
  if (!Array.isArray(inputs)) {
    return null; // No validation schema defined
  }
  
  const requiredInputs = inputs.filter(input => !input.is_optional);
  
  for (const requiredInput of requiredInputs) {
    if (!inputData[requiredInput.name]) {
      return `Required input '${requiredInput.name}' is missing`;
    }
    
    // Basic type validation
    if (requiredInput.type === 'url' && !isValidUrl(inputData[requiredInput.name])) {
      return `Input '${requiredInput.name}' must be a valid URL`;
    }
  }
  
  return null;
}

/**
 * Validate URL format
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Generate content using Fal platform
 */
async function generateWithFal(model, inputData, modelParameters) {
  // Get Fal configuration
  const falConfig = config.aiServices?.image?.providers?.fal || {};
  
  if (!falConfig.apiKey) {
    throw new Error('Fal API key not configured');
  }

  const falProvider = new FalProvider(falConfig);
  
  // Prepare input based on model inputs schema
  const falInput = { ...inputData };
  
  // Apply model parameters (merge with user input, user input takes precedence)
  const finalInput = { ...modelParameters, ...falInput };

  // Submit to Fal using the provider, passing the platform_model_id from the database
  const result = await falProvider.submitImageGenerationRequest(finalInput, {
    modelId: model.platform_model_id
  });

  return {
    request_id: result.request_id,
    status: 'queued',
    platform: 'fal'
  };
}

/**
 * Generate content using Replicate platform
 */
async function generateWithReplicate(model, inputData, modelParameters) {
  // Get Replicate configuration (you'll need to add this to your config)
  const replicateConfig = config.aiServices?.replicate || {};
  
  if (!replicateConfig.apiKey) {
    throw new Error('Replicate API key not configured');
  }

  const replicateProvider = new ReplicateProvider(replicateConfig);
  
  // Prepare input
  const finalInput = { ...modelParameters, ...inputData };

  // Submit to Replicate
  const result = await replicateProvider.submitGenerationRequest(
    model.platform_model_id, 
    finalInput, 
    {}
  );

  return result;
}

/**
 * Get status from Fal platform
 */
async function getStatusFromFal(platformModelId, requestId) {
  const falConfig = config.aiServices?.image?.providers?.fal || {};
  const falProvider = new FalProvider(falConfig);
  
  return await falProvider.checkImageGenerationStatus(requestId, {
    modelId: platformModelId
  });
}

/**
 * Get status from Replicate platform
 */
async function getStatusFromReplicate(requestId) {
  const replicateConfig = config.aiServices?.replicate || {};
  const replicateProvider = new ReplicateProvider(replicateConfig);
  
  return await replicateProvider.getGenerationStatus(requestId);
}

/**
 * Get result from Fal platform
 */
async function getResultFromFal(platformModelId, requestId) {
  const falConfig = config.aiServices?.image?.providers?.fal || {};
  const falProvider = new FalProvider(falConfig);
  
  return await falProvider.getImageGenerationResult(requestId, {
    modelId: platformModelId
  });
}

/**
 * Get result from Replicate platform
 */
async function getResultFromReplicate(requestId) {
  const replicateConfig = config.aiServices?.replicate || {};
  const replicateProvider = new ReplicateProvider(replicateConfig);
  
  return await replicateProvider.getGenerationResult(requestId);
} 