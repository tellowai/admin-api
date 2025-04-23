'use strict';

const AIServicesProviderFactory = require('../factories/provider.factory');
const config = require('../../../config/config');

/**
 * Generate an image based on a text prompt using Fal AI
 */
exports.generateImage = async (req, res) => {
  try {
    // Validate request body
    if (!req.body || !req.body.prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required for image generation'
      });
    }

    // Extract parameters from request
    const { 
      prompt, 
      seed = null, 
      num_images = 1,
      loras = [] 
    } = req.body;

    // Initialize Fal AI provider
    const falProvider = await AIServicesProviderFactory.createProvider('image', 'fal');
    
    // Prepare input for image generation
    const input = {
      prompt,
      seed,
      num_images,
      loras
    };

    // Generate image using Fal AI
    const response = await falProvider.generateImage(input);

    if (!response || !response.data) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate image'
      });
    }

    // Return the response
    return res.status(200).json({
      success: true,
      data: response.data,
      requestId: response.request_id
    });

  } catch (error) {
    console.error('Error in image generation:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during image generation',
      error: error.message
    });
  }
}; 