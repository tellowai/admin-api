'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');
const VideoEditingRateLimiter = require('../middlewares/video.editing.ratelimiter.middleware');
const VideoGeneratorModel = require('../../generators/models/video.generator.model');
const StorageFactory = require('../../os2/providers/storage.factory');

/**
 * @api {post} /video-editing/merge Merge videos
 * @apiVersion 1.0.0
 * @apiName MergeVideos
 * @apiGroup VideoEditing
 * @apiPermission JWT
 *
 * @apiDescription Start asynchronous video merging process
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {Object[]} clips Array of video clips to merge
 * @apiBody {String} clips.asset_key Asset key for the video clip
 * @apiBody {String} clips.asset_bucket Asset bucket for the video clip
 * @apiBody {Number} clips.clip_index Index position of the clip in the merge sequence
 *
 * @apiSuccess {String} merge_id Merge job ID
 * @apiSuccess {String} message Success message
 */
exports.mergeVideos = async function(req, res) {
  const generationId = uuidv4();
  const { clips, sounds } = req.validatedBody;
  const userId = req.user.userId;

  try {
    logger.info('Starting video merge request:', { 
      generationId, 
      userId, 
      clipCount: clips.length,
      soundsCount: sounds.length
    });

    // Insert initial resource generation record in ClickHouse
    await VideoGeneratorModel.insertResourceGeneration([{
      resource_generation_id: generationId,
      user_character_ids: '', // Empty string for video editing (no characters)
      user_id: userId,
      template_id: '', // Empty string for video editing (no template)
      type: 'generation',
      media_type: 'video',
      additional_data: JSON.stringify({
        clips_count: clips.length,
        sounds_count: sounds.length,
        operation: 'merge_videos'
      })
    }]);

    // Insert SUBMITTED event in ClickHouse
    await VideoGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'SUBMITTED',
      additional_data: JSON.stringify({
        user_id: userId,
        clips: clips,
        sounds: sounds,
        operation: 'merge_videos',
        clips_count: clips.length,
        sounds_count: sounds.length,
        request_timestamp: new Date().toISOString()
      })
    }]);

    // Prepare merge data
    const mergeData = {
      generation_id: generationId,
      user_id: userId,
      clips: clips,
      sounds: sounds,
      created_at: new Date().toISOString(),
      status: 'PENDING'
    };

    // Emit Kafka event for video merging
    await kafkaCtrl.sendMessage(
      TOPICS.VIDEO_EDITING_COMMAND_MERGE_VIDEOS,
      [{
        value: mergeData
      }],
      'video_merge_request_submitted'
    );

    // Create activity log entry
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: userId,
          entity_type: 'VIDEO_EDITING',
          action_name: 'VIDEO_MERGE_REQUESTED', 
          entity_id: generationId
        }
      }],
      'video_merge_activity_log'
    );

    // Store rate limiting action after successful submission
    await VideoEditingRateLimiter.storeVideoMergeAction(userId);

    logger.info('Video merge request submitted successfully:', { 
      generationId, 
      userId 
    });

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      generation_id: generationId,
      message: req.t('video_editing:VIDEO_MERGE_STARTED')
    });

  } catch (error) {
    logger.error('Error starting video merge:', { 
      error: error.message, 
      stack: error.stack,
      generationId,
      userId 
    });

    // Insert FAILED event in ClickHouse
    await VideoGeneratorModel.insertResourceGenerationEvent([{
      resource_generation_event_id: uuidv4(),
      resource_generation_id: generationId,
      event_type: 'FAILED',
      additional_data: JSON.stringify({
        error: error.message
      })
    }]);

    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('video_editing:VIDEO_MERGE_FAILED')
    });
  }
};

/**
 * @api {get} /video-editing/merge/:generationId/status Get video merge generation status
 * @apiVersion 1.0.0
 * @apiName GetVideoMergeGenerationStatus
 * @apiGroup VideoEditing
 * @apiPermission JWT
 *
 * @apiDescription Get the status of a video merge generation request
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiParam {String} generationId Generation ID
 *
 * @apiSuccess {Object[]} data Array of generation events
 * @apiSuccess {String} data.resource_generation_event_id Event ID
 * @apiSuccess {String} data.resource_generation_id Generation ID
 * @apiSuccess {String} data.event_type Event type (SUBMITTED, IN_PROGRESS, COMPLETED, FAILED)
 * @apiSuccess {Object} data.additional_data Additional data including output
 * @apiSuccess {String} data.created_at Event creation timestamp
 */
exports.getVideoMergeGenerationStatus = async function(req, res) {
  const { generationId } = req.params;
  const userId = req.user.userId;

  try {
    // First verify ownership
    const hasAccess = await VideoGeneratorModel.verifyGenerationOwnership(generationId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('video_editing:GENERATION_NOT_FOUND')
      });
    }

    // Get all events for this generation
    const generationEvents = await VideoGeneratorModel.getAllGenerationEvents(generationId);
    if (!generationEvents || generationEvents.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('video_editing:GENERATION_NOT_FOUND')
      });
    }

    // Get storage provider for presigned URLs
    const storage = StorageFactory.getProvider();

    // Process each event and add presigned URLs for outputs
    const processedEvents = await Promise.all(
      generationEvents
        .filter(event => ['COMPLETED', 'POST_PROCESSING', 'SUBMITTED', 'IN_PROGRESS', 'FAILED'].includes(event.event_type))
        .map(async (event) => {
          try {
            // Parse additional_data
            const additionalData = JSON.parse(event.additional_data);
            
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
              resource_generation_id: generationId,
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
    logger.error('Error checking video merge generation status:', { 
      error: error.message, 
      stack: error.stack,
      generationId,
      userId 
    });
    
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('video_editing:ERROR_CHECKING_STATUS')
    });
  }
}; 