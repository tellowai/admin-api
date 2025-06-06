'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const GeneratorErrorHandler = require('../middlewares/generator.error.handler');
const CharacterModel = require('../../characters/models/character.model');
const CharacterMediaModel = require('../../characters/models/media.character.model');
const ImageGeneratorModel = require('../models/image.generator.model');
const TemplateModel = require('../../templates/models/template.model');
const AIServicesProviderFactory = require('../../ai-services/factories/provider.factory');
const StorageFactory = require('../../os2/providers/storage.factory');
const moment = require('moment');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');
const MediaFiles = require('../models/media.files.model');
const PaginationController = require('../../core/controllers/pagination.controller');
const EncryptionCtrl = require('../../core/controllers/encryption.controller');
const config = require('../../../config/config');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');

const sanitizePrompt = (prompt) => {
  if (!prompt) return prompt;
  return prompt.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
};

exports.getImageGenerationStatus = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;
  const isAdmin = req.user.isAdmin;

  try {
    // First verify ownership
    if (!isAdmin) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Get the latest event
    let generationEvent = await ImageGeneratorModel.getLatestGenerationEvent(generationId);
    if (!generationEvent) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Only parse and include additional_data if event is completed or post processing
    if (['COMPLETED', 'POST_PROCESSING'].includes(generationEvent.event_type)) {
      try {
        const parsedData = JSON.parse(generationEvent.additional_data);
        
        // Sanitize prompt in fal_status if it exists
        if (parsedData.fal_status?.prompt) {
          parsedData.fal_status.prompt = sanitizePrompt(parsedData.fal_status.prompt);
        }

        // Initialize the response object
        let responseData = {};

        // Handle masks if they exist
        if (parsedData.masks) {
          responseData.masks = parsedData.masks;
        }

        if (parsedData?.event_data?.error) {
          responseData.error = parsedData.event_data.error;
        }

        if (parsedData.original_image) {
          const storage = StorageFactory.getProvider();
          let imageUrl;
          
          if (parsedData.original_image.bucket?.includes('ephemeral')) {
            imageUrl = await storage.generateEphemeralPresignedDownloadUrl(parsedData.original_image.key, { expiresIn: 900 });
          } else {
            imageUrl = await storage.generatePresignedDownloadUrl(parsedData.original_image.key, { expiresIn: 900 });
          }
          
          responseData.original_image = {
            ...parsedData.original_image,
            r2_url: imageUrl
          };
        }

        // Handle media output
        if (parsedData.output?.media?.length > 0) {
          const storage = StorageFactory.getProvider();
          const media = [];
          
          for (let mediaItem of parsedData.output.media) {
            if (mediaItem.cf_r2_key) {
              let imageUrl;
              if (mediaItem.cf_r2_bucket && mediaItem.cf_r2_bucket.includes('ephemeral')) {
                imageUrl = await storage.generateEphemeralPresignedDownloadUrl(mediaItem.cf_r2_key, { expiresIn: 900 });
              } else {
                imageUrl = await storage.generatePresignedDownloadUrl(mediaItem.cf_r2_key, { expiresIn: 900 });
              }
              media.push({
                r2_url: imageUrl
              });
            }
          }
          
          responseData.media = media;
        } else {
          responseData.media = [];
        }

        generationEvent.additional_data = responseData;

      } catch (err) {
        logger.error('Error parsing or processing additional_data:', {
          error: err.message,
          value: generationEvent.additional_data,
          timestamp: new Date().toISOString()
        });
        console.error('Error details:', err.message, 'Raw value:', generationEvent.additional_data);
        generationEvent.additional_data = {
          media: []
        };
      }
    } else {
      delete generationEvent.additional_data;
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: generationEvent
    });

  } catch (error) {
    logger.error('Error checking generation status:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.recreateFromAsset = async function(req, res) {
  const generationId = uuidv4();
  const { asset_key, asset_bucket, user_character_ids } = req.validatedBody;
  const userId = req.user.userId;
  const recreationCredits = 3; // Fixed cost for image recreation

  try {
    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get character data
    const characterData = await CharacterModel.getCharacterDataOfMultipleCharacters(user_character_ids);
    if (!characterData || !characterData.length) {
      throw new Error('Character data not found');
    }

    // Get storage provider and generate presigned URL for the asset
    const storage = StorageFactory.getProvider();
    const assetUrl = await storage.generateEphemeralPresignedDownloadUrl(asset_key, {
      expiresIn: 900
    });

    // Get lora weights for the characters
    const loraWeights = await CharacterMediaModel.getMediaOfMultiplesCharactersByTag(user_character_ids, 'lora_weights');
    const loraWeightsFileR2Keys = loraWeights.map(weight => weight.cf_r2_key);

    // Get URLs for the lora weights
    const r2Options = {
      expiresIn: 900,
    };
    const loras = await Promise.all(
      loraWeightsFileR2Keys.map(key => storage.generatePresignedDownloadUrl(key, r2Options))
    );

    // Initialize LLM provider for image analysis
    const llmProvider = await LLMProviderFactory.createProvider('openai');
    
    // Prepare messages for GPT-4 Vision
    const messages = [
      {
        role: 'system',
        content: 'You are an expert at analyzing images and creating detailed prompts for image generation. Analyze the provided image and create a detailed prompt that captures its essence. Focus on describing the subject, style, composition, lighting, and any unique characteristics. You must respond with a valid JSON object containing a single "prompt" key with a string value.'
      },
      {
        role: 'user',
        content: 'Analyze this image and provide a detailed prompt (100-150 words) that could recreate a similar image. Focus on key visual elements, style, and composition. Respond with a JSON object containing only a "prompt" key. Example response format: {"prompt": "your detailed prompt here"}'
      }
    ];

    // Get image analysis from GPT-4 Vision
    const visionResponse = await llmProvider.createMultiModalCompletion({
      messages,
      images: [assetUrl],
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The generated prompt describing the image'
            }
          },
          required: ['prompt']
        }
      }
    });

    if (!visionResponse.success) {
      throw new Error('Failed to analyze image');
    }

    // Parse the response data if it's a string
    let parsedData;
    try {
      parsedData = typeof visionResponse.data === 'string' 
        ? JSON.parse(visionResponse.data) 
        : visionResponse.data;
    } catch (error) {
      logger.error('Error parsing vision response:', {
        error: error.message,
        data: visionResponse.data
      });
      throw new Error('Failed to parse image analysis response');
    }

    const { prompt } = parsedData;

    if (!prompt) {
      throw new Error('No prompt received from image analysis');
    }
    
    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        original_asset_key: asset_key,
        original_asset_bucket: asset_bucket,
        user_id: userId,
        user_character_ids,
        generated_prompt: prompt
          .replace(/\n/g, ' ') // Replace newlines with spaces
          .replace(/\r/g, ' ') // Replace carriage returns with spaces
          .replace(/\\/g, '\\\\') // Escape backslashes
          .replace(/"/g, '\\"') // Escape double quotes
          .trim(), // Remove leading/trailing whitespace
      })
    }]);

    // Prepare webhook URL
    const encryptedGenerationId = EncryptionCtrl.encrypt(generationId);
    const encryptedGenerationIdHex = EncryptionCtrl.stringToHex(encryptedGenerationId);
    const webhookUrl = config.apiDomainUrl + `/image-generations/${encryptedGenerationIdHex}/fal/webhook`;

    // Prepare generation input
    const generationInput = {
      prompt,
      num_images: 1,
      loras // Add loras from the characters
    };

    const generationOptions = {
      webhookUrl
    };

    // Get AI service provider for image and submit request
    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');
    const queueSubmissionResult = await AIServicesProvider.submitImageGenerationRequest(
      generationInput, 
      generationOptions
    );

    // Publish to Kafka for post-processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_IMAGE_GENERATION,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_id: userId,
          template_id: 'recreate',
          queue_submission_result: queueSubmissionResult,
          original_asset: {
            key: asset_key,
            bucket: asset_bucket
          }
        }
      }],
      'image_generation_request_submitted'
    );

    // Publish to Kafka for template creation
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_CREATE_TEMPLATE_FROM_RECREATION,
      [{
        value: {
          generation_id: generationId,
          user_id: userId,
          user_character_ids,
          prompt,
          original_asset: {
            key: asset_key,
            bucket: asset_bucket
          },
          additional_data: {
            source_type: 'recreation',
            created_at: moment().toISOString(),
            vision_analysis_metrics: visionResponse.metrics
          }
        }
      }],
      'create_template_from_recreation'
    );

    // Sanitize queue_submission_result prompt if it exists
    if (queueSubmissionResult?.fal_status?.prompt) {
      queueSubmissionResult.fal_status.prompt = sanitizePrompt(queueSubmissionResult.fal_status.prompt);
    }

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        user_id: userId,
        character_id: null,
        generationInput,
        queue_submission_result: queueSubmissionResult
      })
    }]);

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('generator:IMAGE_RECREATION_STARTED')
    });

  } catch (error) {
    logger.error('Error recreating image from asset:', { error: error.message, stack: error.stack });

    // Insert failed status
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'FAILED',
      additional_data: JSON.stringify({
        error: error.message,
        user_character_ids
      })
    }]);

    GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.handleCoupleInpainting = async function(req, res) {
  const generationId = uuidv4();
  const adminId = req.user.userId;
  const { 
    asset_key, 
    asset_bucket, 
    user_character_ids, 
    user_character_genders,
    male_prompt, 
    female_prompt 
  } = req.validatedBody;
  const userId = req.user.userId;

  try {
    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get character data for prompt generation if prompts not provided
    let finalMalePrompt = male_prompt;
    let finalFemalePrompt = female_prompt;
    
    if (!finalMalePrompt || !finalFemalePrompt) {
      // Set fallback prompts if still not available
      finalMalePrompt = 'restore';
      finalFemalePrompt = 'restore';
    }

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        asset_key,
        asset_bucket,
        user_id: userId,
        user_character_ids,
        user_character_genders,
        male_prompt: finalMalePrompt,
        female_prompt: finalFemalePrompt
      })
    }]);

    // Send to Kafka for processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_START_COUPLE_INPAINTING,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_character_genders,
          user_id: userId,
          asset_key,
          asset_bucket,
          male_prompt: finalMalePrompt,
          female_prompt: finalFemalePrompt
        }
      }],
      'start_couple_inpainting'
    );

    // Log admin activity
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'STUDIO_TOOLS',
          action_name: 'COUPLE_INPAINTING', 
          entity_id: generationId,
          additional_data: JSON.stringify({
            user_character_ids,
            user_character_genders
          })
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        generation_id: generationId,
        status: 'SUBMITTED'
      }
    });

  } catch (error) {
    logger.error('Error submitting couple inpainting request:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.handleMultiCharacterInpainting = async function(req, res) {
  const generationId = uuidv4();
  const adminId = req.user.userId;
  const { 
    asset_key, 
    asset_bucket, 
    user_characters
  } = req.validatedBody;
  const userId = req.user.userId;

  try {
    // Extract character IDs for ownership verification
    const user_character_ids = user_characters.map(char => char.id);
    
    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Extract other data from user_characters
    const user_character_genders = user_characters.map(char => char.gender);
    const user_character_prompts = user_characters.map(char => char.prompt);
    const user_character_mask_prompts = user_characters.map(char => char.mask_prompt || null);

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        asset_key,
        asset_bucket,
        user_id: userId,
        user_character_ids,
        user_character_genders,
        user_character_prompts,
        user_character_mask_prompts,
        user_characters // Store the complete user_characters array for reference
      })
    }]);

    // Send to Kafka for processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_START_MULTI_CHARACTER_INPAINTING,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_character_genders,
          user_character_prompts,
          user_character_mask_prompts,
          user_characters, // Include the complete user_characters array
          user_id: userId,
          asset_key,
          asset_bucket
        }
      }],
      'start_multi_character_inpainting'
    );

    // Log admin activity
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'STUDIO_TOOLS',
          action_name: 'MULTI_CHARACTER_INPAINTING', 
          entity_id: generationId,
          additional_data: JSON.stringify({
            user_character_ids,
            user_character_genders,
            user_character_prompts,
            user_character_mask_prompts,
            user_characters // Include the complete user_characters array
          })
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        generation_id: generationId,
        status: 'SUBMITTED'
      }
    });

  } catch (error) {
    logger.error('Error submitting multi-character inpainting request:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.handleTextToImage = async function(req, res) {
  const generationId = uuidv4();
  const userId = req.user.userId;
  const { 
    prompt,
    character_id,
    imageSize,
    width,
    height,
    num_inference_steps,
    seed,
    guidance_scale,
    num_images,
    output_format,
    enable_safety_checker
  } = req.validatedBody;

  try {
    let generationInput = {
      prompt: sanitizePrompt(prompt),
      num_images: parseInt(num_images || '1'),
      width,
      height,
      num_inference_steps,
      seed,
      guidance_scale,
      output_format
    };

    // Add enable_safety_checker only if it's provided
    if (enable_safety_checker !== undefined) {
      generationInput.enable_safety_checker = enable_safety_checker;
    }

    // If character_id is provided, get lora weights
    if (character_id) {
      // Verify character ownership
      const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters([character_id], userId);
      if (!hasAccess) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
        });
      }

      // Get character data and lora weights
      const characterData = await CharacterModel.getCharacterDataOfMultipleCharacters([character_id]);
      if (!characterData || !characterData.length) {
        throw new Error('Character data not found');
      }

      const triggerWord = characterData[0].trigger_word;
      if (triggerWord) {
        // Create trigger word with gender if needed
        const selectedCharacterGender = characterData[0].character_gender;
        let finalTriggerWordReplacement = triggerWord;
        if (selectedCharacterGender && selectedCharacterGender !== 'couple') {
          finalTriggerWordReplacement = `${triggerWord}, ${selectedCharacterGender}`;
        }
        
        // Add trigger word to prompt
        generationInput.prompt = `${generationInput.prompt}, ${finalTriggerWordReplacement}`;
      }

      // Get lora weights
      const loraWeights = await CharacterMediaModel.getMediaOfMultiplesCharactersByTag([character_id], 'lora_weights');
      if (loraWeights && loraWeights.length > 0) {
        const loraWeightsFileR2Keys = loraWeights.map(weight => weight.cf_r2_key);
        const storage = StorageFactory.getProvider();
        const r2Options = { expiresIn: 900 };
        const loras = await Promise.all(
          loraWeightsFileR2Keys.map(key => storage.generatePresignedDownloadUrl(key, r2Options))
        );
        generationInput.loras = loras;
      }
    }

    // Prepare webhook URL
    const encryptedGenerationId = EncryptionCtrl.encrypt(generationId);
    const encryptedGenerationIdHex = EncryptionCtrl.stringToHex(encryptedGenerationId);
    const webhookUrl = config.apiDomainUrl + `/image-generations/${encryptedGenerationIdHex}/fal/webhook`;

    // Get AI service provider for image and submit request
    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');
    const queueSubmissionResult = await AIServicesProvider.submitImageGenerationRequest(
      generationInput,
      { webhookUrl }
    );

    // Sanitize queue_submission_result prompt if it exists
    if (queueSubmissionResult?.fal_status?.prompt) {
      queueSubmissionResult.fal_status.prompt = sanitizePrompt(queueSubmissionResult.fal_status.prompt);
    }

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        user_id: userId,
        character_id,
        generationInput,
        queue_submission_result: queueSubmissionResult
      })
    }]);

    // Publish to Kafka for post-processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_IMAGE_GENERATION,
      [{
        value: {
          generation_id: generationId,
          user_id: userId,
          character_id,
          queue_submission_result: queueSubmissionResult
        }
      }],
      'image_generation_request_submitted'
    );

    // Log admin activity
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: userId,
          entity_type: 'STUDIO_TOOLS',
          action_name: 'TEXT_TO_IMAGE', 
          entity_id: generationId,
          additional_data: JSON.stringify({
            character_id,
            enable_safety_checker,
            width,
            height,
            num_inference_steps,
            guidance_scale,
            num_images
          })
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      data: {
        generation_id: generationId,
        message: req.t('generator:IMAGE_GENERATION_STARTED')
      }
    });

  } catch (error) {
    logger.error('Error submitting text-to-image request:', { error: error.message, stack: error.stack });

    // Insert failed status
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'FAILED',
      additional_data: JSON.stringify({
        error: error.message,
        character_id
      })
    }]);

    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};
