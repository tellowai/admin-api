'use strict';

const AIServicesProviderFactory = require('../factories/provider.factory');
const config = require('../../../config/config');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * Generate an image based on a text prompt using Fal AI
 */
exports.generateImage = async (req, res) => {
  try {
    // Validate request body
    if (!req.body || !req.body.prompt) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Prompt is required for image generation'
      });
    }

    // Extract parameters from request
    const { 
      prompt, 
      seed = null, 
      num_images = 1,
      width = 1024,
      height = 1024,
      quality = null,
      loras = [] 
    } = req.body;

    // Initialize Fal AI provider
    const falProvider = await AIServicesProviderFactory.createProvider('image', 'fal');
    
    // Prepare input for image generation
    const input = {
      prompt,
      seed,
      num_images,
      width,
      height,
      quality,
      loras
    };

    // Generate image using Fal AI
    const response = await falProvider.generateImage(input);

    if (!response || !response.data) {
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to generate image'
      });
    }

    // Return the response with consistent format
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: response.data,
      requestId: response.request_id
    });

  } catch (error) {
    console.error('Error in image generation:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error during image generation',
      error: error.message
    });
  }
}; 