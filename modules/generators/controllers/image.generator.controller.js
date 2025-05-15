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
const CreditsService = require('../../credits/services/credits.service');
const MediaFiles = require('../models/media.files.model');
const PaginationController = require('../../core/controllers/pagination.controller');
const EncryptionCtrl = require('../../core/controllers/encryption.controller');
const config = require('../../../config/config');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');



/**
 * @api {post} /generators/images Start image generation
 * @apiVersion 1.0.0
 * @apiName GenerateImages
 * @apiGroup Generators
 * @apiPermission JWT
 *
 * @apiDescription Start asynchronous image generation for a project
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String} user_character_id Character's unique ID
 * @apiBody {String} character_id Character's unique ID
 * @apiBody {Number} [count=1] Number of images to generate (max 10)
 * @apiBody {Object} [options] Generation options
 * @apiBody {String} [options.style] Style preset to use
 * @apiBody {String} [options.prompt] Additional prompt
 * @apiBody {String} [options.negative_prompt] Negative prompt
 * @apiBody {Number} [options.seed] Random seed
 * @apiBody {Number} [options.guidance_scale] Guidance scale (1-20)
 *
 * @apiSuccess {String} generation_id Generation job ID
 * @apiSuccess {String} message Success message
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 202 Accepted
 *     {
 *       "generation_id": "clh7tpzxk000008l4g0hs3j2p",
 *       "message": "Image generation started"
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid request data
 * @apiError NotFound Project not found
 * @apiError TooManyRequests Generation rate limit exceeded
 */
exports.generateImages = async function(req, res) {
  const generationId = uuidv4();
  const { user_character_ids, template_id } = req.validatedBody;
  const userId = req.user.userId;
  const tryAgain = req.query.try_again === 'true';
  let template;

  try {
    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get template data
    template = await TemplateModel.getTemplatePrompt(template_id);

    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }
    
    await CreditsService.reserveCredits(
      userId, 
      template.credits, 
      'image_generation', 
      generationId, 
      `Image generation with template id ${template_id}`
    );

    const loraWeights = await CharacterMediaModel.getMediaOfMultiplesCharactersByTag(user_character_ids, 'lora_weights');
    const loraWeightsFileR2Keys = loraWeights.map(weight => weight.cf_r2_key);

    const characterData = await CharacterModel.getCharacterDataOfMultipleCharacters(user_character_ids);
    if (!characterData || !characterData.length) {
      throw new Error('Character data not found');
    }

    const triggerWord = characterData[0].trigger_word;
    if (!triggerWord) {
      throw new Error('Trigger word not found for character');
    }

    const r2Options = {
      expiresIn: 900,
    }

    // Get storage provider
    const storage = StorageFactory.getProvider();
    const loras = await Promise.all(
      loraWeightsFileR2Keys.map(key => storage.generatePresignedDownloadUrl(key, r2Options))
    );

    // Use template prompt and replace trigger word
    const prompt = template.prompt.replace('{{TRIGGER_WORD}}', triggerWord || '');
    let additionalData = template.additional_data;

    if (additionalData && typeof additionalData === 'string') {
      try {
        additionalData = JSON.parse(template.additional_data);
      } catch (err) {
        logger.error('Error parsing additional_data:', {
          error: err.message, 
          value: additionalData
        });
      }
    }

    const generationInput = {
      loras,
      prompt,
      num_images: 1
    };

    if(!tryAgain) {
      // generationInput.seed = additionalData.seed;
    }
    
    const generationOptions = {};
    let totalGenerationTime = 0;
    let generationResult;

    const startTime = moment();

    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');
    generationResult = await AIServicesProvider.generateImage(generationInput, generationOptions);
    
    const endTime = moment();
    totalGenerationTime = endTime.diff(startTime);

    await CreditsService.deductReservedCredits(
      userId, 
      template.credits, 
      'image_generation', 
      generationId, 
      `Image generation with template id ${template_id}`
  );

    // Extract image URLs from generation results
    const imageUrls = generationResult?.data?.images?.map(image => image?.url) || [];

    // Publish generation command
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_PHOTO_GENERATION_POST_PROCESS,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_id: userId,
          template_id,
          total_generation_time: totalGenerationTime,
          generation_result: generationResult
        }
      }],
      'start_photo_generation_post_process'
    );

    // Return accepted response with generation ID
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      generation_id: generationId,
      image_urls: imageUrls,
      message: req.t('generator:IMAGES_GENERATED')
    });

  } catch (error) {
    logger.error('Error starting image generation:', { error: error.message, stack: error.stack });

    if (error?.code !== 'INSUFFICIENT_CREDITS') {
      await CreditsService.releaseReservedCredits(
        userId, 
        template.credits, 
        'image_generation', 
        generationId, 
        `Image generation with template id ${template_id}`
      );
    }

    await ImageGeneratorModel.insertImageGenerations({
      generation_id: generationId,
      user_character_id: user_character_ids[0],
      user_id: userId,
      template_id,
      status: 'failed'
    });

    GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.generateImagesQueue = async function(req, res) {
  const generationId = uuidv4();
  const { user_character_ids, template_id } = req.validatedBody;
  const userId = req.user.userId;
  let template;

  try {
    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get template data
    template = await TemplateModel.getTemplatePrompt(template_id);
    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Reserve credits for image generation
    await CreditsService.reserveCredits(
      userId, 
      template.credits, 
      'image_generation', 
      generationId, 
      `Image generation with template id ${template_id}`
    );

    const loraWeights = await CharacterMediaModel.getMediaOfMultiplesCharactersByTag(user_character_ids, 'lora_weights');
    const loraWeightsFileR2Keys = loraWeights.map(weight => weight.cf_r2_key);

    const characterData = await CharacterModel.getCharacterDataOfMultipleCharacters(user_character_ids);
    if (!characterData || !characterData.length) {
      throw new Error('Character data not found');
    }

    const triggerWord = characterData[0].trigger_word;
    if (!triggerWord) {
      throw new Error('Trigger word not found for character');
    }

    const r2Options = {
      expiresIn: 900,
    }

    // Get storage provider
    const storage = StorageFactory.getProvider();
    const loras = await Promise.all(
      loraWeightsFileR2Keys.map(key => storage.generatePresignedDownloadUrl(key, r2Options))
    );

    // Create trigger word with gender if needed
    const selectedCharacterGender = characterData[0].character_gender;
    let finalTriggerWordReplacement = triggerWord;
    if (selectedCharacterGender && selectedCharacterGender !== 'couple') {
      finalTriggerWordReplacement = `${triggerWord}, ${selectedCharacterGender}`;
    }

    // Use template prompt and replace trigger word
    const prompt = template.prompt.replace('{{TRIGGER_WORD}}', finalTriggerWordReplacement || '');

    const generationInput = {
      loras,
      prompt,
      num_images: 1
    };

    const encryptedGenerationId = EncryptionCtrl.encrypt(generationId);
    const encryptedGenerationIdHex = EncryptionCtrl.stringToHex(encryptedGenerationId);
    const webhookUrl = config.apiDomainUrl + `/image-generations/${encryptedGenerationIdHex}/fal/webhook`;
    const generationOptions = {
      webhookUrl
    };

    // Get AI service provider for image and submit request
    let queueSubmissionResult;
    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');
    queueSubmissionResult = await AIServicesProvider.submitImageGenerationRequest(
      generationInput, 
      generationOptions
    );

    // Sanitize prompt for ClickHouse multi-line insertion
    generationInput.prompt = generationInput.prompt.replace(/\n/g, ' ').replace(/\r/g, ' ').trim();

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        template_id,
        user_character_ids,
        user_id: userId,
        generationInput, 
        generationOptions,
        queue_submission_result: queueSubmissionResult
      })
    }]);

    // Publish to Kafka for post-processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_IMAGE_GENERATION,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_id: userId,
          template_id,
          queue_submission_result: queueSubmissionResult
        }
      }],
      'image_generation_request_submitted'
    );

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('generator:IMAGE_GENERATION_STARTED')
    });

  } catch (error) {
    logger.error('Error starting image generation:', { error: error.message, stack: error.stack });

    if (error?.code !== 'INSUFFICIENT_CREDITS') {
      await CreditsService.releaseReservedCredits(
        userId, 
        template.credits, 
        'image_generation', 
        generationId, 
        `Image generation with template id ${template_id}`
      );
    }

    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'FAILED',
      additional_data: JSON.stringify({
        error: error.message
      })
    }]);

    GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.getUserGenerations = async function(req, res) {
  try {
    const userId = req.user.userId;
    const paginationParams = PaginationController.getPaginationParams(req.query);
    const type = req.query.type;
    
    // Get media files
    const mediaFiles = await MediaFiles.getUserGenerations(
      userId, 
      paginationParams.page, 
      paginationParams.limit,
      type
    );

    if (!mediaFiles.length) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: []
      });
    }

    // Get unique character IDs
    const userCharacterIds = [...new Set(mediaFiles.map(file => file.user_character_id))];
    
    // Get character details
    const characterDetails = await MediaFiles.getCharacterDetails(userCharacterIds);
    
    // Create a map for quick character lookup
    const characterMap = characterDetails.reduce((acc, char) => {
      acc[char.user_character_id] = char;
      return acc;
    }, {});

    // Get storage provider for presigned URLs
    const storage = StorageFactory.getProvider();

    // Combine the data and parse additional_data
    const generations = await Promise.all(mediaFiles.map(async file => {
      let parsedAdditionalData = {};
      try {
        parsedAdditionalData = JSON.parse(file.additional_data);
      } catch (err) {
        logger.error('Error parsing additional_data:', { 
          error: err.message, 
          value: file.additional_data 
        });
      }

      // Get presigned URLs
      const imageUrl = file.cf_r2_key ? await storage.generatePresignedDownloadUrl(file.cf_r2_key) : null;
      const characterImageUrl = characterMap[file.user_character_id]?.thumb_cf_r2_key ? 
        await storage.generatePresignedDownloadUrl(characterMap[file.user_character_id].thumb_cf_r2_key) : null;

      return {
        media_id: file.media_id,
        user_character_id: file.user_character_id,
        cf_r2_key: file.cf_r2_key,
        cf_r2_url: imageUrl,
        image_url: imageUrl,
        tag: file.tag,
        generation_id: parsedAdditionalData.generation_id,
        created_at: file.created_at,
        character_name: characterMap[file.user_character_id]?.character_name || null,
        character_image_url: characterImageUrl
      };
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: generations
    });
  } catch (err) {
    logger.error('Error fetching user generations:', { error: err.message, stack: err.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('generator:ERROR_FETCHING_GENERATIONS')
    });
  }
};

exports.getImageGenerationStatus = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;

  try {
    // First verify ownership
    const hasAccess = await ImageGeneratorModel.verifyGenerationOwnership(generationId, userId);
    if (!hasAccess) {
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

        if (parsedData.output?.media?.length > 0) {
          const storage = StorageFactory.getProvider();
          const media = [];
          
          for (let mediaItem of parsedData.output.media) {
            if (mediaItem.cf_r2_key) {
              const imageUrl = await storage.generatePresignedDownloadUrl(mediaItem.cf_r2_key, { expiresIn: 900 });
              media.push({
                r2_url: imageUrl
              });
            }
          }
          
          generationEvent.additional_data = {
            media
          };
        } else {
          generationEvent.additional_data = {
            media: []
          };
        }

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
    // Reserve credits for image recreation
    await CreditsService.reserveCredits(
      userId, 
      recreationCredits, 
      'image_generation', 
      generationId, 
      `Image recreation from asset ${asset_key}`
    );

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

    // Deduct reserved credits once the request is submitted successfully
    await CreditsService.deductReservedCredits(
      userId, 
      recreationCredits, 
      'image_generation', 
      generationId, 
      `Image recreation from asset ${asset_key}`
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

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('generator:IMAGE_RECREATION_STARTED')
    });

  } catch (error) {
    logger.error('Error recreating image from asset:', { error: error.message, stack: error.stack });

    // Release reserved credits if error occurs (unless it's an insufficient credits error)
    if (error?.code !== 'INSUFFICIENT_CREDITS') {
      await CreditsService.releaseReservedCredits(
        userId, 
        recreationCredits, 
        'image_generation', 
        generationId, 
        `Image recreation from asset ${asset_key}`
      );
    }

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

exports.upscaleImage = async function(req, res) {
  const generationId = uuidv4();
  const { asset_key, asset_bucket, model_name } = req.validatedBody;
  const userId = req.user.userId;
  const upscalingCredits = 2; // Fixed cost for image upscaling

  try {
    // Reserve credits for image upscaling
    await CreditsService.reserveCredits(
      userId, 
      upscalingCredits, 
      'image_generation', 
      generationId, 
      `Image upscaling for asset ${asset_key}`
    );

    // Get configuration for upscaling
    const upscalingConfig = config.aiServices.image.providers.fal.upscaling;
    
    // Determine model ID based on input or default
    let modelId = upscalingConfig.defaultModelId;
    if (model_name && upscalingConfig.models[model_name]) {
      modelId = upscalingConfig.models[model_name];
    }

    // Get storage provider and generate presigned URL for the asset
    const storage = StorageFactory.getProvider();
    const assetUrl = await storage.generateEphemeralPresignedDownloadUrl(asset_key, {
      expiresIn: 900
    });

    // Prepare webhook URL with the new format
    const encryptedGenerationId = EncryptionCtrl.encrypt(generationId);
    const encryptedGenerationIdHex = EncryptionCtrl.stringToHex(encryptedGenerationId);
    const webhookUrl = config.apiDomainUrl + `/image-upscale/${encryptedGenerationIdHex}/fal/webhook`;

    // Prepare upscaling input
    const upscalingInput = {
      image_url: assetUrl,
      model_id: modelId
    };

    const upscalingOptions = {
      webhookUrl
    };

    // Get AI service provider for image and submit upscaling request
    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');
    const queueSubmissionResult = await AIServicesProvider.submitUpscalingRequest(
      upscalingInput, 
      upscalingOptions
    );

    // Insert initial record in database
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        original_asset_key: asset_key,
        user_id: userId,
        model_id: modelId,
        model_name: model_name || 'clarity',
        upscaling_type: 'image',
        webhookUrl,
        queue_submission_result: queueSubmissionResult
      })
    }]);

    // Deduct reserved credits once the request is submitted successfully
    await CreditsService.deductReservedCredits(
      userId, 
      upscalingCredits, 
      'image_generation', 
      generationId, 
      `Image upscaling for asset ${asset_key}`
    );

    // Publish to Kafka for processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_IMAGE_UPSCALING,
      [{
        value: {
          generation_id: generationId,
          user_id: userId,
          model_id: modelId,
          model_name: model_name || 'clarity',
          original_asset: {
            key: asset_key
          },
          queue_submission_result: queueSubmissionResult
        }
      }],
      'image_upscaling_request_submitted'
    );

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('generator:IMAGE_UPSCALING_STARTED')
    });

  } catch (error) {
    logger.error('Error starting image upscaling:', { error: error.message, stack: error.stack });

    // Release credits if there was an error
    if (error?.code !== 'INSUFFICIENT_CREDITS') {
      await CreditsService.releaseReservedCredits(
        userId, 
        upscalingCredits, 
        'image_generation', 
        generationId, 
        `Image upscaling for asset ${asset_key}`
      );
    }

    // Log failure event
    await ImageGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'FAILED',
      additional_data: JSON.stringify({
        error: error.message
      })
    }]);

    GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.getUpscalingStatus = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;

  try {
    // First verify ownership
    const hasAccess = await ImageGeneratorModel.verifyGenerationOwnership(generationId, userId);
    if (!hasAccess) {
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

        if (parsedData.output?.media?.length > 0) {
          const storage = StorageFactory.getProvider();
          const media = [];
          
          for (let mediaItem of parsedData.output.media) {
            if (mediaItem.cf_r2_key) {
              const imageUrl = await storage.generatePresignedDownloadUrl(mediaItem.cf_r2_key, { expiresIn: 900 });
              media.push({
                r2_url: imageUrl
              });
            }
          }
          
          generationEvent.additional_data = {
            media
          };
        } else {
          generationEvent.additional_data = {
            media: []
          };
        }

      } catch (err) {
        logger.error('Error parsing or processing additional_data:', {
          error: err.message,
          value: generationEvent.additional_data,
          timestamp: new Date().toISOString()
        });
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
    logger.error('Error checking upscaling status:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};
