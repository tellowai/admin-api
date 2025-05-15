'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const GeneratorErrorHandler = require('../middlewares/generator.error.handler');
const CharacterModel = require('../../characters/models/character.model');
const CharacterMediaModel = require('../../characters/models/media.character.model');
const TemplateModel = require('../../templates/models/template.model');
const VideoGeneratorModel = require('../models/video.generator.model');
const AIServicesProviderFactory = require('../../ai-services/factories/provider.factory');
const StorageFactory = require('../../os2/providers/storage.factory');
const moment = require('moment');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');
const CreditsService = require('../../credits/services/credits.service');
const MediaFiles = require('../models/media.files.model');
const PaginationController = require('../../core/controllers/pagination.controller');
const config = require("../../../config/config");
const EncryptionCtrl = require("../../core/controllers/encryption.controller");

/**
 * @api {post} /generators/videos Start video generation
 * @apiVersion 1.0.0
 * @apiName GenerateVideos
 * @apiGroup Generators
 * @apiPermission JWT
 *
 * @apiDescription Start asynchronous video generation for a character
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String[]} user_character_ids Array of character IDs
 * @apiBody {String} template_id Template ID to use
 *
 * @apiSuccess {String} generation_id Generation job ID
 * @apiSuccess {String} message Success message
 */
exports.generateVideos = async function(req, res) {
  const generationId = uuidv4();
  const { user_character_ids, template_id, cf_r2_key } = req.validatedBody;
  const userId = req.user.userId;
  let template;

  try {
    
    // Verify character ownership
    // const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(user_character_ids, userId);
    // if (!hasAccess) {
    //   return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
    //     message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
    //   });
    // }

    // Get template data
    template = await TemplateModel.getTemplatePrompt(template_id);
    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Verify template is for video output
    if (template?.template_output_type !== 'video') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('template:NOT_VIDEO_TEMPLATE')
      });
    }
    
    // Reserve credits for video generation
    await CreditsService.reserveCredits(
      userId, 
      template.credits, 
      'video_generation', 
      generationId, 
      `Video generation with template id ${template_id}`
    );

    // Insert initial record in ClickHouse
    await VideoGeneratorModel.insertResourceGeneration([{
      resource_generation_id: generationId,
      user_character_ids: user_character_ids.join(','),
      user_id: userId,
      template_id,
      type: 'generation',
      media_type: 'video',
      additional_data: JSON.stringify(template.additional_data || {})
    }]);

    // Generate presigned URL for the input video
    const r2Options = {
      expiresIn: 900,
    }

    const storage = StorageFactory.getProvider();
    const presignedUrl = await storage.generatePresignedDownloadUrl(cf_r2_key, r2Options);

    // Prepare generation input
    const generationInput = {
      prompt: template.prompt,
      subject_reference_image_url: presignedUrl
    };

    const encryptedGenerationId = EncryptionCtrl.encrypt(generationId);
    const encryptedGenerationIdHex = EncryptionCtrl.stringToHex(encryptedGenerationId);
    const webhookUrl = config.apiDomainUrl + `/video-generations/${encryptedGenerationIdHex}/fal/minimax-subjref/webhook`;
    const generationOptions = {
      webhookUrl
    }

    // Get AI service provider for video and submit request
    let queueSubmissionResult;
    if (process.env.NODE_ENV !== 'local') {
      const AIServicesProvider = await AIServicesProviderFactory.createProvider('video');
      queueSubmissionResult = await AIServicesProvider.submitVideoGenerationRequest(
        generationInput, 
        generationOptions
      );
    } else {
      queueSubmissionResult =  {
        "template_id":"20abf185-de04-40f3-b7ee-e7b9696e427f",
        "user_character_ids":[],
        generationInput, 
        generationOptions,
        "queue_submission_result":{
          "request_id":"c41fbcdd-6680-4453-94d6-9cb4620bcb42"
        }
      };
    }

    // Insert SUBMITTED event in ClickHouse with AI response
    await VideoGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        template_id,
        user_character_ids,
        user_id: userId,
        cf_r2_key,
        generationInput, 
        generationOptions,
        queue_submission_result: queueSubmissionResult
      })
    }]);

    // Deduct reserved credits
    await CreditsService.deductReservedCredits(
      userId, 
      template.credits, 
      'video_generation', 
      generationId, 
      `Video generation with template id ${template_id}`
    );

    // Publish to Kafka for post-processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_VIDEO_GENERATION,
      [{
        value: {
          generation_id: generationId,
          user_character_ids,
          user_id: userId,
          template_id,
          queue_submission_result: queueSubmissionResult
        }
      }],
      'video_generation_request_submitted'
    );

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('generator:VIDEO_GENERATION_STARTED')
    });

  } catch (error) {
    logger.error('Error starting video generation:', { error: error.message, stack: error.stack });

    if (error?.code !== 'INSUFFICIENT_CREDITS') {
      await CreditsService.releaseReservedCredits(
        userId, 
        template.credits, 
        'video_generation', 
        generationId, 
        `Video generation with template id ${template_id}`
      );
    }

    // Insert failed status in ClickHouse
    await VideoGeneratorModel.insertResourceGenerationEvent([{
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

/**
 * @api {get} /generators/videos Get user's video generations
 * @apiVersion 1.0.0
 * @apiName GetUserVideoGenerations
 * @apiGroup Generators
 * @apiPermission JWT
 *
 * @apiDescription Get list of user's video generations
 *
 * @apiHeader {String} Authorization JWT token
 */
exports.getUserGenerations = async function(req, res) {
  try {
    const userId = req.user.userId;
    const paginationParams = PaginationController.getPaginationParams(req.query);
    
    // Get media files
    const mediaFiles = await MediaFiles.getUserGenerations(
      userId, 
      paginationParams.page, 
      paginationParams.limit,
      'video'
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

      const character = characterMap[file.user_character_id] || {};
      const videoUrl = await storage.generatePresignedDownloadUrl(file.cf_r2_key, { expiresIn: 3600 });

      return {
        generation_id: file.generation_id,
        character_name: character.name,
        character_image: character.image_url,
        video_url: videoUrl,
        created_at: file.created_at,
        status: file.status,
        ...parsedAdditionalData
      };
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: generations
    });

  } catch (error) {
    logger.error('Error getting user video generations:', { error: error.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('common:INTERNAL_SERVER_ERROR')
    });
  }
}; 

exports.getVideoGenerationStatus = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;

  try {
    // First verify ownership
    const hasAccess = await VideoGeneratorModel.verifyGenerationOwnership(generationId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Get the latest event
    let generationEvent = await VideoGeneratorModel.getLatestGenerationEvent(generationId);
    if (!generationEvent) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }
    // Only parse and include additional_data if event is completed or post processing
    if (['COMPLETED', 'POST_PROCESSING'].includes(generationEvent.event_type)) {
      try {
        generationEvent.additional_data = JSON.parse(generationEvent.additional_data);
        
        // Get storage provider for presigned URLs if output exists
        if (generationEvent.additional_data.output?.cf_r2_key) {
          const storage = StorageFactory.getProvider();
          const videoUrl = await storage.generatePresignedDownloadUrl(generationEvent.additional_data.output.cf_r2_key, { expiresIn: 900 });
          generationEvent.additional_data.output.r2_url = videoUrl;
        }
      } catch (err) {
        logger.error('Error parsing additional_data:', { 
          error: err.message, 
          value: generationEvent.additional_data 
        });
        generationEvent.additional_data = {};
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


exports.getVideoGenerationStatusFromServiceProvider = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;

  try {
    // First verify ownership
    const hasAccess = await VideoGeneratorModel.verifyGenerationOwnership(generationId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Get the latest event
    const generationEvent = await VideoGeneratorModel.getLatestGenerationEvent(generationId);
    if (!generationEvent) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Parse additional data to get FAL request ID
    let parsedAdditionalData = {};
    try {
      parsedAdditionalData = JSON.parse(generationEvent.additional_data);
    } catch (err) {
      logger.error('Error parsing additional_data:', { 
        error: err.message, 
        value: generationEvent.additional_data 
      });
    }

    // Extract user_character_ids, template_id and user_id from additional data
    const user_character_ids = parsedAdditionalData?.user_character_ids;
    const template_id = parsedAdditionalData?.template_id;
    const user_id = parsedAdditionalData?.user_id;

    // Get FAL request ID from the SUBMITTED event
    const falRequestId = parsedAdditionalData?.queue_submission_result?.request_id;
    let falStatus = null;

    // If we have a FAL request ID and the event is not final (completed/failed), check with FAL
    if (falRequestId && !['POST_PROCESSING', 'FAILED'].includes(generationEvent.event_type)) {
      const AIServicesProvider = await AIServicesProviderFactory.createProvider('video');
      falStatus = await AIServicesProvider.checkVideoGenerationStatus(falRequestId);

      // Insert event in ClickHouse with FAL status if available
      if (falStatus && falStatus?.status !== 'COMPLETED') {
        await VideoGeneratorModel.insertResourceGenerationEvent([{
          resource_generation_event_id: uuidv4(),
          resource_generation_id: generationId,
          event_type: falStatus.status,
          additional_data: JSON.stringify({
            template_id,
            user_character_ids,
            user_id,
            fal_status: falStatus
          })
        }]);
      }
      
      if (falStatus?.status === 'COMPLETED') {
        const falGenResult = await AIServicesProvider.getVideoGenerationResult(falRequestId);
      }
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      status: generationEvent.event_type,
      created_at: generationEvent.created_at,
      fal_status: falStatus,
      ...parsedAdditionalData
    });

  } catch (error) {
    logger.error('Error checking generation status:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};
