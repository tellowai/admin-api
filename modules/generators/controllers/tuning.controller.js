'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { createId } = require('@paralleldrive/cuid2');
const GeneratorErrorHandler = require('../middlewares/generator.error.handler');
const CharacterMediaModel = require('../../characters/models/media.character.model');
const CharacterModel = require('../../characters/models/character.model');
const TuningRateLimiterMiddleware = require('../middlewares/tuning.ratelimiter.middleware');
const {
  insertTuningSession,
  getLatestTuningSession,
  getTuningSessionEvents
} = require('../models/tuning.ai.model');
const AIServicesProviderFactory = require('../../ai-services/factories/provider.factory');
const TuningSessionModel = require('../models/tuning.session.model');


/**
 * @api {post} /photo-tuning-sessions Start model tuning session
 * @apiVersion 1.0.0
 * @apiName CreatePhotoTuningSession
 * @apiGroup ModelTuning
 * @apiPermission JWT
 *
 * @apiDescription Start a new model tuning/training session for a character
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String} user_character_id Character's unique ID
 * @apiQuery {Boolean} [confirmReTune=false] Confirm re-training if character already has a tuning session
 *
 * @apiSuccess {String} tuning_session_id Tuning session ID
 * @apiSuccess {String} message Success message
 */
exports.createPhotoTuningSession = async function(req, res) {
  // Generate unique ID for this tuning session
  const tuningSessionId = createId();
  const { user_character_id } = req.validatedBody;
  const userId = req.user.userId;

  try {
    // Verify character ownership
    const hasAccess = await CharacterMediaModel.verifyAdminCharacter(user_character_id);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Check for existing tuning session
    const existingSession = await getLatestTuningSession(user_character_id);
    if (existingSession) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('generator:TUNING_SESSION_EXISTS_ONLY_ONE_TRAINING_PER_CHARACTER_ALLOWED'),
        existing_session: {
          tuning_session_id: existingSession.tuning_session_id,
          created_at: existingSession.created_at
        }
      });
    }

    // Prepare tuning session data for ClickHouse
    const tuningSessionData = {
      tuning_session_id: tuningSessionId,
      user_character_id,
      user_id: userId,
      media_type: 'image'
    };

    // insert tuning data into clickhouse
    await insertTuningSession([tuningSessionData]);
    
    // Publish tuning command
    await kafkaCtrl.sendMessage(
      TOPICS.MODEL_TUNING_COMMAND_START_PHOTO_TUNING,
      [{
        value: {
          tuning_session_id: tuningSessionId,
          user_character_id,
          user_id: userId,
          credits: 50
        }
      }],
      'start_model_photo_tuning'
    );
    
    // Update character training status to indicate tuning has started
    await CharacterModel.updateCharacterData(user_character_id, {
      training_status: 'queued'
    });

    // Store rate limit action
    TuningRateLimiterMiddleware.storePhotoModelTuningAction(userId);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: userId,
          entity_type: 'PHOTO_TUNING_SESSIONS',
          action_name: 'CREATE_PHOTO_TUNING_SESSION', 
          entity_id: user_character_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.ACCEPTED).json({
      tuning_session_id: tuningSessionId,
      message: req.t('generator:MODEL_TUNING_QUEUED')
    });

  } catch (error) {
    logger.error('Error starting model tuning:', { error: error.message, stack: error.stack });

    GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
};

/**
 * @api {get} /characters/:userCharacterId/tuning-session-date Get tuning session submission date
 * @apiVersion 1.0.0
 * @apiName GetTuningSessionDate
 * @apiGroup ModelTuning
 * @apiPermission JWT
 *
 * @apiDescription Get the submission date of tuning session for a character
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiParam {String} userCharacterId Character's unique ID
 *
 * @apiSuccess {DateTime} created_at Tuning session submission date
 * @apiSuccess {String} message Success message
 */
exports.getTuningSessionData = async function(req, res) {
  const { userCharacterId } = req.params;
  const userId = req.user.userId;

  try {
    // Verify character ownership
    const hasAccess = await CharacterMediaModel.verifyCharacterOwnership(userCharacterId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get latest tuning session for the character
    const tuningSession = await getLatestTuningSession(userCharacterId);
    if (!tuningSession) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:NO_TUNING_SESSION_FOUND')
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: tuningSession
    });
  } catch (error) {
    logger.error('Error getting tuning session date:', error);
    return GeneratorErrorHandler.handleGeneratorErrors(error, req, res);
  }
};

/**
 * @api {get} /users/characters/:userCharacterId/tuning-sessions/status Check tuning status
 * @apiVersion 1.0.0
 * @apiName CheckTuningStatus
 * @apiGroup ModelTuning
 * @apiPermission JWT
 *
 * @apiDescription Check the status of a character's tuning session from FAL API
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiParam {String} userCharacterId Character's unique ID
 *
 * @apiSuccess {Object} data Tuning session data with status
 * @apiSuccess {String} message Success message
 */
exports.checkTuningStatus = async function(req, res) {
  const { userCharacterId, tuningSessionId } = req.params;
  const userId = req.user.userId;

  try {
    // Verify character ownership
    const hasAccess = await CharacterMediaModel.verifyCharacterOwnership(userCharacterId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get latest tuning session for the character
    const tuningSessionSubmittedEvents = await TuningSessionModel.getTuningSessionEvents(
      tuningSessionId, 
      'SUBMITTED'
    );

    if (!tuningSessionSubmittedEvents || tuningSessionSubmittedEvents.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('generator:NO_TUNING_SESSION_FOUND')
      });
    }

    const additionalData = JSON.parse(tuningSessionSubmittedEvents[0].additional_data);
    if (!additionalData || !additionalData.fal_queue_data || !additionalData.fal_queue_data.request_id) {
      throw new Error('Invalid or missing fal_queue_data');
    }
    const request_id = additionalData.fal_queue_data.request_id;

    const aiServiceRequestId = request_id;

    // Get FAL provider instance
    const AIServicesProvider = await AIServicesProviderFactory.createProvider('image');

    // Check tuning status from FAL
    const status = await AIServicesProvider.checkTuningStatus(aiServiceRequestId);
    logger.info('FAL tuning status:', { status });

    // If status is completed, get the results
    if (status.status === 'completed') {
      const results = await AIServicesProvider.getTuningResult(aiServiceRequestId);
      logger.info('FAL tuning results:', results);
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        status
      },
      message: req.t('generator:TUNING_STATUS_FETCHED')
    });

  } catch (error) {
    logger.error('Error checking tuning status:', error);
    return GeneratorErrorHandler.handleGeneratorErrors(error, res);
  }
}; 