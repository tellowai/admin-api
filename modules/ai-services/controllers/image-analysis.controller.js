'use strict';

const OpenAIProvider = require('../providers/openai/openai.provider');
const config = require('../../../config/config');
const { getActiveModelData } = require('./active.model.selection');

/**
 * Analyze an uploaded image using OpenAI's vision capabilities
 * and extract a title and prompt description
 */
exports.analyzeImage = async (req, res) => {
  try {
    // Check if image file is provided
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Get file buffer and convert to base64
    const imageBuffer = req.file.buffer;
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Initialize OpenAI provider with config
    const openaiProvider = new OpenAIProvider({
      llmProviders: config.llmProviders
    });
    await openaiProvider.initialize();

    // Get active model data - ensure it has vision capabilities
    const activeModel = await getActiveModelData('gpt-4o');
    
    if (!activeModel.capabilities.includes('vision')) {
      return res.status(400).json({
        success: false,
        message: 'The active model does not support vision capabilities'
      });
    }

    // Define system message for the prompt
    const systemMessage = {
      role: 'system',
      content: `You are an expert image analyzer and creative template builder. 
      You analyze images and provide:
      1. A concise, engaging title for a template based on this image
      2. A detailed prompt that captures the essence, style, and key elements of the image
      
      Return your analysis in JSON format with 'title' and 'prompt' fields.
      The title should be short (2-6 words), catchy, and descriptive.
      The prompt should be detailed enough to recreate the style and content of the image.`
    };

    // Create user message with the image
    const userMessage = {
      role: 'user',
      content: 'Analyze this image and provide a creative title and detailed prompt that captures its essence, style, and key elements.'
    };

    // Define response format
    const responseFormat = {
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "A concise, catchy title (2-6 words) for a template based on this image"
          },
          prompt: {
            type: "string",
            description: "A detailed prompt describing the style, elements, mood, and composition of the image"
          }
        },
        required: ["title", "prompt"]
      },
      schemaName: "ImageAnalysis"
    };

    // Make the API call
    const response = await openaiProvider.createMultiModalCompletion({
      messages: [systemMessage, userMessage],
      responseFormat: responseFormat,
      images: [base64Image]
    });

    if (!response.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to analyze image',
        error: response.error
      });
    }

    // Return the successful response
    return res.status(200).json({
      success: true,
      data: response.data,
      metrics: response.metrics
    });

  } catch (error) {
    console.error('Error in image analysis:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during image analysis',
      error: error.message
    });
  }
}; 