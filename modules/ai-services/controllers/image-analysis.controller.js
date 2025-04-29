'use strict';

const OpenAIProvider = require('../providers/openai/openai.provider');
const config = require('../../../config/config');
const { getActiveModelData } = require('./active.model.selection');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * Analyze an uploaded image using OpenAI's vision capabilities
 * and extract a title and prompt description
 */
exports.analyzeImage = async (req, res) => {
  try {
    // Check if image file is provided
    if (!req.file) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
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
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
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
      3. The gender category of the subjects in the image
      
      VERY IMPORTANT: The prompt MUST begin with "a {{TRIGGER_WORD}} " followed by a description.
      For example: "a {{TRIGGER_WORD}} walking on a beach at sunset" or "a {{TRIGGER_WORD}} in a vintage car driving through mountains"
      
      DO NOT use phrases like "Create a..." or "Generate a..." - just describe what's in the image starting with "a {{TRIGGER_WORD}}".
      
      For the gender field, you must categorize the image as one of these options:
      - "male" (if it only contains one or more male subjects)
      - "female" (if it only contains one or more female subjects)
      - "couple" (if it contains both male and female subjects or appears to be a couple)
      
      Return your analysis in JSON format with 'title', 'prompt', and 'gender' fields.
      The title should be short (2-6 words), catchy, and descriptive.
      The prompt should be detailed enough to recreate the style and content of the image.
      The gender should be one of the three options mentioned above.`
    };

    // Create user message with the image
    const userMessage = {
      role: 'user',
      content: 'Analyze this image and provide a creative title, detailed prompt that captures its essence, and the gender category (male, female, or couple). Remember, the prompt MUST start with "a {{TRIGGER_WORD}} " followed by the description.'
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
            description: "A detailed prompt starting with 'a {{TRIGGER_WORD}} ' followed by a description of the style, elements, mood, and composition of the image"
          },
          gender: {
            type: "string",
            enum: ["male", "female", "couple"],
            description: "The gender category of the subjects in the image (male, female, or couple)"
          }
        },
        required: ["title", "prompt", "gender"]
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
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to analyze image',
        error: response.error
      });
    }

    // Process the response data
    let responseData = response.data;
    
    // Parse the data if it's a string
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (error) {
        console.error('Error parsing response data:', error);
      }
    }
    
    // Ensure prompt format starts with a {{TRIGGER_WORD}}
    if (responseData && responseData.prompt) {
      // Remove any "Create a" or similar prefixes
      let prompt = responseData.prompt
        .replace(/^(create\s+a|generate\s+a|produce\s+a|make\s+a)/i, '')
        .trim();
      
      // Add {{TRIGGER_WORD}} if it's not already there
      if (!prompt.startsWith('a {{TRIGGER_WORD}}')) {
        if (prompt.startsWith('a ') || prompt.startsWith('an ')) {
          prompt = 'a {{TRIGGER_WORD}} ' + prompt.substring(2);
        } else {
          prompt = 'a {{TRIGGER_WORD}} ' + prompt;
        }
      }
      
      responseData.prompt = prompt;
    }

    // Return the processed response without success field
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: responseData,
      metrics: response.metrics
    });

  } catch (error) {
    console.error('Error in image analysis:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error during image analysis',
      error: error.message
    });
  }
}; 