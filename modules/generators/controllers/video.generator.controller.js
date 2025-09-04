'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const GeneratorErrorHandler = require('../middlewares/generator.error.handler');
const GeneratorRateLimiterMiddleware = require('../middlewares/generator.ratelimiter.middleware');
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

exports.getVideoFlowComposerGenerationStatus = async function(req, res) {
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

    // Get all events for this generation
    const generationEvents = await VideoGeneratorModel.getAllGenerationEvents(generationId);
    if (!generationEvents || generationEvents.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Get storage provider for presigned URLs
    const storage = StorageFactory.getProvider();

    // Process each event and add presigned URLs for outputs
    const processedEvents = await Promise.all(
      generationEvents
        .filter(event => ['COMPLETED', 'POST_PROCESSING'].includes(event.event_type))
        .map(async (event) => {
          try {
            // Parse additional_data
            const additionalData = JSON.parse(event.additional_data);
            
            // Remove unnecessary keys from additional_data
            const keysToRemove = ['inpainted_image', 'video', 'characters', 'inpainting_steps', 'input_image', 'prompt', 'video_ai_model'];
            keysToRemove.forEach(key => {
              delete additionalData[key];
            });
            
            // Check if output exists with asset information
            if (additionalData.output && additionalData.output.asset_key && additionalData.output.asset_bucket) {
              const { asset_key, asset_bucket } = additionalData.output;
              
              // Determine which presigned URL method to use based on bucket
              let presignedUrl;
              if (asset_bucket.includes('ephemeral')) {
                presignedUrl = await storage.generateEphemeralPresignedDownloadUrl(asset_key, { expiresIn: 900 });
              } else {
                presignedUrl = await storage.generatePresignedDownloadUrl(asset_key, { expiresIn: 900 });
              }
              
              // Add r2_url to output
              additionalData.output.r2_url = presignedUrl;
            }
            
            return {
              ...event,
              additional_data: additionalData
            };
          } catch (err) {
            logger.error('Error parsing additional_data for event:', { 
              error: err.message, 
              event_id: event.resource_generation_event_id,
              value: event.additional_data 
            });
            return {
              ...event,
              additional_data: {}
            };
          }
        })
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: processedEvents
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

exports.handleVideoFlowComposer = async function(req, res) {
  const generationId = uuidv4();
  const adminId = req.user.userId;
  const clipsData = req.validatedBody.clips;
  const userId = req.user.userId;

  try {
    // Extract character IDs from all clips for ownership verification
    const characterIds = [];
    for (const clip of clipsData) {
      if (clip.video_type === 'ai' && clip.characters && clip.characters.length > 0) {
        clip.characters.forEach(char => {
          if (char.character && char.character.character_id) {
            characterIds.push(char.character.character_id);
          }
        });
      }
    }

    // Verify character ownership if characters are present
    if (characterIds.length > 0) {
      const uniqueCharacterIds = [...new Set(characterIds)];
      const hasAccess = await CharacterModel.verifyCharacterOwnershipOfMultipleCharacters(uniqueCharacterIds);
      if (!hasAccess) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
        });
      }
    }

    // Extract video quality information for AI clips
    const aiClipsWithQuality = clipsData
      .filter(clip => clip.video_type === 'ai')
      .map(clip => ({
        clip_index: clip.clip_index,
        video_quality: clip.video_quality || '360p'
      }));

        // Create summary data for ClickHouse (avoid storing large JSON)
    const summaryData = {
      generation_type: 'video_flow_composer',
      total_clips: clipsData.length,
      ai_clips_count: clipsData.filter(clip => clip.video_type === 'ai').length,
      static_clips_count: clipsData.filter(clip => clip.video_type === 'static').length,
      video_qualities: aiClipsWithQuality,
      clip_summary: clipsData.map(clip => ({
        clip_index: clip.clip_index,
        video_type: clip.video_type,
        video_quality: clip.video_quality || (clip.video_type === 'ai' ? '360p' : undefined),
        reference_image_type: clip.reference_image_type || undefined,
        character_count: clip.characters ? clip.characters.length : 0
      }))
    };

    // Insert initial resource generation record in ClickHouse
    await VideoGeneratorModel.insertResourceGeneration([{
      resource_generation_id: generationId,
      user_character_ids: characterIds.join(','),
      user_id: userId,
      template_id: '', // Empty string for video flow composer (no template)
      type: 'generation',
      media_type: 'video',
      additional_data: JSON.stringify(summaryData)
    }]);

        // Insert SUBMITTED event in ClickHouse (store summary instead of full data)
    await VideoGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        user_id: userId,
        character_ids: characterIds,
        total_clips: clipsData.length,
        video_qualities: aiClipsWithQuality,
        clip_summary: summaryData.clip_summary,
        request_timestamp: new Date().toISOString()
      })
    }]);

    // Process clips data and extract video quality information
    const processedClipsData = clipsData.map(clip => {
      if (clip.video_type === 'ai' && clip.video_quality) {
        return {
          ...clip,
          video_quality: clip.video_quality || '360p' // Default to 360p if not specified
        };
      }
      return clip;
    });

    // Send to Kafka for processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_START_VIDEO_FLOW_COMPOSER,
      [{
        value: {
          generation_id: generationId,
          clips_data: processedClipsData,
          user_id: userId,
          character_ids: characterIds,
          total_clips: clipsData.length,
          video_qualities: processedClipsData
            .filter(clip => clip.video_type === 'ai')
            .map(clip => clip.video_quality || '360p')
        }
      }],
      'start_video_flow_composer'
    );

    // Log admin activity
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'STUDIO_TOOLS',
          action_name: 'VIDEO_FLOW_COMPOSER', 
          entity_id: generationId,
          additional_data: JSON.stringify({
            total_clips: clipsData.length,
            character_ids: characterIds,
            ai_clips_count: clipsData.filter(clip => clip.video_type === 'ai').length,
            static_clips_count: clipsData.filter(clip => clip.video_type === 'static').length,
            video_qualities: aiClipsWithQuality
          })
        }
      }],
      'create_admin_activity_log'
    );

    // Publish event for analytics
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_EVENT_REQUEST_SUBMITTED_FOR_VIDEO_FLOW_COMPOSER,
      [{
        value: {
          generation_id: generationId,
          user_id: userId,
          total_clips: clipsData.length,
          ai_clips_count: clipsData.filter(clip => clip.video_type === 'ai').length,
          static_clips_count: clipsData.filter(clip => clip.video_type === 'static').length,
          character_ids: characterIds,
          video_qualities: aiClipsWithQuality
        }
      }],
      'video_flow_composer_request_submitted'
    );

    // Store rate limiter action
    await GeneratorRateLimiterMiddleware.storeVideoFlowComposerAction(userId);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        generation_id: generationId,
        status: 'SUBMITTED',
        total_clips: clipsData.length
      }
    });

  } catch (error) {
    logger.error('Error submitting video flow composer request:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.handleWorkflowQueue = async function(req, res) {
  const generationId = uuidv4();
  const adminId = req.user.userId;
  const userId = req.user.userId;
  const { clips, custom_text_input_fields=[], template_id, uploaded_assets=[], user_character_ids=[] } = req.validatedBody;

  try {
    // Create summary data for ClickHouse (avoid storing large JSON)
    const summaryData = {
      generation_type: 'workflow_queue',
      template_id,
      user_character_ids,
      total_workflows: clips.reduce((total, clip) => total + clip.workflow.length, 0),
      custom_text_input_fields_count: custom_text_input_fields ? custom_text_input_fields.length : 0,
      uploaded_assets_count: uploaded_assets ? uploaded_assets.length : 0,
      clip_summary: clips.map(clip => ({
        clip_index: clip.clip_index,
        asset_type: clip.asset_type,
        workflow_count: clip.workflow.length,
        workflow_codes: clip.workflow.map(w => w.workflow_code)
      }))
    };

    // Insert initial resource generation record in ClickHouse
    await VideoGeneratorModel.insertResourceGeneration([{
      resource_generation_id: generationId,
      user_character_ids: user_character_ids.join(','),
      user_id: userId,
      template_id,
      type: 'generation',
      media_type: 'video',
      additional_data: JSON.stringify(summaryData)
    }]);

    // Insert SUBMITTED event in ClickHouse (store actual data only)
    await VideoGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        user_id: userId,
        template_id,
        user_character_ids,
        clips_data: clips,
        custom_text_input_fields,
        uploaded_assets,
        request_timestamp: new Date().toISOString()
      })
    }]);

    // Send to Kafka for processing
    // await kafkaCtrl.sendMessage(
    //   TOPICS.GENERATION_COMMAND_START_ADMIN_TEST_WORKFLOW, // Reusing existing topic for workflow processing
    //   [{
    //     value: {
    //       generation_id: generationId,
    //       generation_type: 'workflow_queue',
    //       user_character_ids,
    //       clips,
    //       custom_text_input_fields,
    //       template_id,
    //       uploaded_assets,
    //       user_id: userId
    //     }
    //   }],
    //   'start_admin_test_workflow'
    // );

    // Log admin activity
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'STUDIO_TOOLS',
          action_name: 'ADMIN_TEST_WORKFLOW', 
          entity_id: generationId,
          additional_data: JSON.stringify({
            template_id,
            total_clips: clips.length,
            total_workflows: summaryData.total_workflows,
            user_character_ids_count: user_character_ids.length,
            custom_text_input_fields_count: summaryData.custom_text_input_fields_count,
            uploaded_assets_count: summaryData.uploaded_assets_count
          })
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        generation_id: '691c6c68-a402-477b-b40c-95c900218607',
        status: 'SUBMITTED',
        total_clips: clips.length,
        total_workflows: summaryData.total_workflows
      }
    });

  } catch (error) {
    logger.error('Error submitting workflow queue request:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

exports.getWorkflowGenerationStatus = async function(req, res) {
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

    // Get all events for this generation
    const generationEvents = await VideoGeneratorModel.getAllGenerationEvents(generationId);
    if (!generationEvents || generationEvents.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:GENERATION_NOT_FOUND')
      });
    }

    // Get storage provider for presigned URLs
    const storage = StorageFactory.getProvider();

    // Helper function to populate URLs for assets
    const populateAssetUrls = async (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      if (Array.isArray(obj)) {
        return Promise.all(obj.map(item => populateAssetUrls(item)));
      }

      const result = { ...obj };
      
      // Check if this object has asset_key and asset_bucket
      if (result.asset_key && result.asset_bucket && !result.url && !result.r2_url) {
        try {
          let presignedUrl;
          if (result.asset_bucket.includes('ephemeral')) {
            presignedUrl = await storage.generateEphemeralPresignedDownloadUrl(result.asset_key, { expiresIn: 900 });
          } else if(result.asset_bucket.includes('public')) {
            presignedUrl = await storage.generatePublicBucketPresignedDownloadUrl(result.asset_key, { expiresIn: 900 });
          } else {
            presignedUrl = await storage.generatePresignedDownloadUrl(result.asset_key, { expiresIn: 900 });
          }
          result.url = presignedUrl;
        } catch (err) {
          logger.error('Error generating presigned URL:', { 
            error: err.message, 
            asset_key: result.asset_key, 
            asset_bucket: result.asset_bucket 
          });
        }
      }

      // Recursively process nested objects
      for (const key in result) {
        if (typeof result[key] === 'object' && result[key] !== null) {
          result[key] = await populateAssetUrls(result[key]);
        }
      }

      return result;
    };

    // Process each event and add presigned URLs for assets
    const processedEvents = await Promise.all(
      generationEvents
        .filter(event => ['COMPLETED', 'POST_PROCESSING'].includes(event.event_type))
        .map(async (event) => {
          try {
            // Parse additional_data
            let additionalData = JSON.parse(event.additional_data);
            
            // Populate URLs for all assets in the data
            additionalData = await populateAssetUrls(additionalData);
            
            return {
              ...event,
              additional_data: additionalData
            };
          } catch (err) {
            logger.error('Error parsing additional_data for event:', { 
              error: err.message, 
              event_id: event.resource_generation_event_id,
              value: event.additional_data 
            });
            return {
              ...event,
              additional_data: {}
            };
          }
        })
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: processedEvents
    });

  } catch (error) {
    logger.error('Error checking workflow generation status:', { error: error.message, stack: error.stack });
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};
