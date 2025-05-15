'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const log = require('../../../config/lib/logger');
const TuningSessionModel = require('../models/tuning.session.model');
const { createId } = require('@paralleldrive/cuid2');
const StorageFactory = require('../../os2/providers/storage.factory');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const VideoGeneratorModel = require('../models/video.generator.model');
const { v4: uuidv4 } = require('uuid');
const ImageGeneratorModel = require('../models/image.generator.model');


/**
 * @api {post} /tuning-sessions/:tuningSessionId/webhook FAL Training Webhook
 * @apiPrivate
 * @apiVersion 1.0.0
 * @apiName TuningWebhook
 * @apiGroup ModelTuning
 *
 * @apiHeader {String} x-fal-signature HMAC SHA256 signature
 *
 * @apiParam {String} tuningSessionId Tuning session ID
 *
 * @apiBody {String} status Training status (completed/failed)
 * @apiBody {String} requestId FAL request ID
 * @apiBody {Object} [error] Error details if failed
 */
exports.handleTuningWebhook = async function(req, res) {
  try {
    const tuningSessionId = req.tuningSessionId;
    const { payload } = req.body;
    const finalMessageForKafkaEvent = {
      tuning_session_id: tuningSessionId,
      ...payload
    };

    // Get tuning session event to extract metadata
    const tuningSessionPostProcessingEvent = await TuningSessionModel.getTuningSessionEvents(
      tuningSessionId, 
      'POST_PROCESSING'
    );

    // Return early if we already have a post-processing event for this session
    if (tuningSessionPostProcessingEvent && tuningSessionPostProcessingEvent.length > 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        received: true,
        message: 'Webhook already processed'
      });
    }
    
    // publish kafka event
    await kafkaCtrl.sendMessage(
      TOPICS.MODEL_TUNING_COMMAND_PHOTO_TUNE_POST_PROCESS,
      [{
        value: finalMessageForKafkaEvent
      }],
      'start_photo_tuning_post_process'
    );

    const tuningSessionEvent = [{
      tuning_session_event_id: createId(),
      tuning_session_id: tuningSessionId,
      event_type: 'POST_PROCESSING',
      additional_data: JSON.stringify(payload)
    }];

    await TuningSessionModel.insertTuningSessionEvent(tuningSessionEvent);

    // Publish generation command
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_POST_TRAINING_FREE_PHOTOS,
      [{
        value: finalMessageForKafkaEvent
      }],
      'generate_post_training_free_photos'
    );


    return res.status(HTTP_STATUS_CODES.OK).json({ 
      received: true
    });

  } catch (error) {
    log.error('Error handling tuning webhook:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Failed to process webhook'
    });
  }
};

/**
 * @api {post} /video-generations/:generationId/fal/webhook FAL Video Generation Webhook
 * @apiPrivate
 * @apiVersion 1.0.0
 * @apiName VideoGenerationWebhook
 * @apiGroup Generators
 *
 * @apiHeader {String} x-fal-signature HMAC SHA256 signature
 *
 * @apiParam {String} generationId Generation ID (encrypted)
 *
 * @apiBody {String} status Generation status (completed/failed)
 * @apiBody {String} requestId FAL request ID
 * @apiBody {Object} [error] Error details if failed
 */
exports.handleMiniMaxSubjectRefFalWebhook = async function(req, res) {
  try {
    const generationId = req.generationId;
    const { payload } = req.body;

    // Check if we already have a post-processing event for this generation
    const latestEvent = await VideoGeneratorModel.getLatestGenerationEvent(generationId);
    if (latestEvent && latestEvent.event_type === 'POST_PROCESSING') {
      return res.status(HTTP_STATUS_CODES.OK).json({
        received: true,
        message: req.t('generator:WEBHOOK_ALREADY_PROCESSED')
      });
    }

     // Parse additional data to get FAL request ID
     let parsedAdditionalData = {};
     try {
       parsedAdditionalData = JSON.parse(latestEvent.additional_data);
     } catch (err) {
       log.error('Error parsing additional_data:', { 
         error: err.message, 
         value: latestEvent.additional_data 
       });
     }

    // Extract user_character_ids, template_id and user_id from additional data
    const user_character_ids = parsedAdditionalData?.user_character_ids;
    const template_id = parsedAdditionalData?.template_id;
    const user_id = parsedAdditionalData?.user_id;

    // Insert event based on status
    const eventType = 'POST_PROCESSING';

    const generationEvent = [{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: eventType,
      additional_data: JSON.stringify({
        template_id,
        user_character_ids,
        user_id,
        fal_status: payload
      })
    }];

    await VideoGeneratorModel.insertResourceGenerationEvent(generationEvent);

    // If successful, publish to Kafka for post-processing
    if (eventType === 'POST_PROCESSING') {
      await kafkaCtrl.sendMessage(
        TOPICS.GENERATION_COMMAND_VIDEO_GENERATION_POST_PROCESS,
        [{
          value: {
            generation_id: generationId,
            template_id,
            user_character_ids,
            user_id,
            ...payload
          }
        }],
        'start_video_generation_post_process'
      );
    }

    return res.status(HTTP_STATUS_CODES.OK).json({ 
      received: true
    });

  } catch (error) {
    log.error('Error handling video generation webhook:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('generator:WEBHOOK_PROCESSING_FAILED')
    });
  }
};

/**
 * @api {post} /image-generations/:generationId/fal/webhook FAL Image Generation Webhook
 * @apiPrivate
 * @apiVersion 1.0.0
 * @apiName ImageGenerationWebhook
 * @apiGroup Generators
 *
 * @apiHeader {String} x-fal-signature HMAC SHA256 signature
 *
 * @apiParam {String} generationId Generation ID (encrypted)
 *
 * @apiBody {String} status Generation status (completed/failed)
 * @apiBody {String} requestId FAL request ID
 * @apiBody {Object} [error] Error details if failed
 */
exports.handleImageGenerationFalWebhook = async function(req, res) {
  try {
    const generationId = req.generationId;
    const { payload } = req.body;

    // Check if we already have a post-processing event for this generation
    const latestEvent = await ImageGeneratorModel.getLatestGenerationEvent(generationId);
    if (latestEvent && latestEvent.event_type === 'POST_PROCESSING') {
      return res.status(HTTP_STATUS_CODES.OK).json({
        received: true,
        message: req.t('generator:WEBHOOK_ALREADY_PROCESSED')
      });
    }
console.log(latestEvent,'----latestEvent----')
    // Parse additional data from latest event
    let parsedAdditionalData = {};
    try {
      parsedAdditionalData = JSON.parse(latestEvent.additional_data);
    } catch (err) {
      log.error('Error parsing additional_data:', { 
        error: err.message, 
        value: latestEvent?.additional_data 
      });
    }

    // Extract metadata from additional data
    const user_character_ids = parsedAdditionalData?.user_character_ids;
    const template_id = parsedAdditionalData?.template_id;
    const user_id = parsedAdditionalData?.user_id;

    // Insert POST_PROCESSING event
    const generationEvent = [{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'POST_PROCESSING',
      additional_data: JSON.stringify({
        template_id,
        user_character_ids,
        user_id,
        fal_status: payload
      })
    }];
console.log(generationEvent,'-generationEvent>')
    await ImageGeneratorModel.insertResourceGenerationEvent(generationEvent);
    
    // Extract the images array and other data from payload for Kafka message
    const { images, timings, seed, has_nsfw_concepts, prompt } = payload;

    console.log({
      value: {
        generation_id: generationId,
        template_id,
        user_character_ids,
        user_id,
        images,
        timings,
        seed,
        has_nsfw_concepts,
        prompt
      }
    },'------->1')
    
    // Publish event for post-processing
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_IMAGE_GENERATION_POST_PROCESS,
      [{
        value: {
          generation_id: generationId,
          template_id,
          user_character_ids,
          user_id,
          // Include all payload fields directly in the root
          images,
          timings,
          seed,
          has_nsfw_concepts,
          prompt
        }
      }],
      'start_image_generation_post_process'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({ 
      received: true
    });

  } catch (error) {
    log.error('Error handling image generation webhook:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('generator:WEBHOOK_PROCESSING_FAILED')
    });
  }
};

/**
 * @api {post} /image-upscale/:upscaleGenerationId/fal/webhook FAL Image Upscaling Webhook
 * @apiPrivate
 * @apiVersion 1.0.0
 * @apiName ImageUpscalingWebhook
 * @apiGroup Generators
 *
 * @apiHeader {String} x-fal-signature HMAC SHA256 signature
 *
 * @apiParam {String} upscaleGenerationId Upscale Generation ID (encrypted)
 *
 * @apiBody {String} status Upscaling status (completed/failed)
 * @apiBody {String} requestId FAL request ID
 * @apiBody {Object} [error] Error details if failed
 */
exports.handleImageUpscaleFalWebhook = async function(req, res) {
  try {
    const generationId = req.generationId;
    const { payload } = req.body;
console.log(payload,'payload')
    // Check if we already have a post-processing event for this generation
    const latestEvent = await ImageGeneratorModel.getLatestGenerationEvent(generationId);
    if (latestEvent && latestEvent.event_type === 'POST_PROCESSING') {
      return res.status(HTTP_STATUS_CODES.OK).json({
        received: true,
        message: req.t('generator:WEBHOOK_ALREADY_PROCESSED')
      });
    }

    // Parse additional data from latest event
    let parsedAdditionalData = {};
    try {
      parsedAdditionalData = JSON.parse(latestEvent.additional_data);
    } catch (err) {
      log.error('Error parsing additional_data:', { 
        error: err.message, 
        value: latestEvent?.additional_data 
      });
    }

    // Extract metadata from additional data
    const user_id = parsedAdditionalData?.user_id;
    const model_id = parsedAdditionalData?.model_id;
    const model_name = parsedAdditionalData?.model_name;
    const original_asset_key = parsedAdditionalData?.original_asset_key;

    // Insert POST_PROCESSING event with the exact format requested
    const generationEvent = [{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'POST_PROCESSING',
      additional_data: JSON.stringify({
        user_id,
        model_id,
        model_name,
        original_asset_key,
        fal_status: payload
      })
    }];

    await ImageGeneratorModel.insertResourceGenerationEvent(generationEvent);

    // Prepare Kafka message - check for proper structure of the payload
    let kafkaMessageData = {
      generation_id: generationId,
      user_id,
      model_id,
      model_name,
      original_asset_key
    };

    // Create images array from the single image object returned by clarity-upscaler
    if (payload.image) {
      kafkaMessageData.images = [payload.image];
    } 
    // Or use existing images array if present
    else if (payload.images && Array.isArray(payload.images)) {
      kafkaMessageData.images = payload.images;
    } 
    // Check nested output format
    else if (payload.output && payload.output.images && Array.isArray(payload.output.images)) {
      kafkaMessageData.images = payload.output.images;
    }
    // If no images are found, create an empty array
    else {
      kafkaMessageData.images = [];
      log.warn('No images found in upscaling webhook payload', { payload });
    }

    // Add other fields from payload
    if (payload.timings) kafkaMessageData.timings = payload.timings;
    if (payload.seed) kafkaMessageData.seed = payload.seed;
    if (payload.has_nsfw_concepts) kafkaMessageData.has_nsfw_concepts = payload.has_nsfw_concepts;
    if (payload.prompt) kafkaMessageData.prompt = payload.prompt;

    // Log the message for debugging
    console.log('Upscaling Kafka message data:', kafkaMessageData);

    // Publish event for post-processing with the requested format
    await kafkaCtrl.sendMessage(
      TOPICS.GENERATION_COMMAND_IMAGE_GENERATION_POST_PROCESS,
      [{
        value: kafkaMessageData
      }],
      'image_upscaling_request_submitted'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({ 
      received: true
    });

  } catch (error) {
    log.error('Error handling image upscaling webhook:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('generator:WEBHOOK_PROCESSING_FAILED')
    });
  }
};