'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const NicheModel = require('../models/niche.model');
const NicheErrorHandler = require('../middlewares/niche.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {get} /niches List niches
 * @apiVersion 1.0.0
 * @apiName ListNiches
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listNiches = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const niches = await NicheModel.listNiches(paginationParams);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: niches
    });

  } catch (error) {
    logger.error('Error listing niches:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {post} /niches Create niche
 * @apiVersion 1.0.0
 * @apiName CreateNiche
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiBody {String} niche_name Niche name
 * @apiBody {String} thumb_image_object_key Thumbnail image object key
 * @apiBody {String} thumb_image_storage_bucket Thumbnail image storage bucket
 * @apiBody {String} slug Unique slug
 * @apiBody {Number} [display_order] Display order
 * @apiBody {Boolean} [is_active=true] Whether niche is active
 */
exports.createNiche = async function(req, res) {
  try {
    const nicheData = req.validatedBody;

    // Check if slug already exists
    const existingNiche = await NicheModel.getNicheBySlug(nicheData.slug);
    if (existingNiche) {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        message: req.t('niche:SLUG_EXISTS')
      });
    }

    const result = await NicheModel.createNiche(nicheData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHES',
          action_name: 'ADD_NEW_NICHE', 
          entity_id: result.insertId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('niche:NICHE_CREATED'),
      data: { niche_id: result.insertId }
    });

  } catch (error) {
    logger.error('Error creating niche:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {get} /niches/:nicheId Get niche by ID
 * @apiVersion 1.0.0
 * @apiName GetNicheById
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 */
exports.getNicheById = async function(req, res) {
  try {
    const { nicheId } = req.params;
    const niche = await NicheModel.getNicheById(nicheId);

    if (!niche) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: niche
    });

  } catch (error) {
    logger.error('Error getting niche by ID:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {patch} /niches/:nicheId Update niche
 * @apiVersion 1.0.0
 * @apiName UpdateNiche
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiBody {String} [niche_name] Niche name
 * @apiBody {String} [thumb_image_object_key] Thumbnail image object key
 * @apiBody {String} [thumb_image_storage_bucket] Thumbnail image storage bucket
 * @apiBody {Number} [display_order] Display order
 * @apiBody {Boolean} [is_active] Whether niche is active
 * @apiNote slug is not updatable after creation
 */
exports.updateNiche = async function(req, res) {
  try {
    const { nicheId } = req.params;
    const nicheData = req.validatedBody;

    // Check if niche exists
    const existingNiche = await NicheModel.getNicheById(nicheId);
    if (!existingNiche) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Remove slug from update data - it's not updatable
    delete nicheData.slug;

    const updated = await NicheModel.updateNiche(nicheId, nicheData);

    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHES',
          action_name: 'UPDATE_NICHE', 
          entity_id: nicheId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('niche:NICHE_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating niche:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {post} /niches/:nicheId/archive Archive niche
 * @apiVersion 1.0.0
 * @apiName ArchiveNiche
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 */
exports.archiveNiche = async function(req, res) {
  try {
    const { nicheId } = req.params;

    const archived = await NicheModel.archiveNiche(nicheId);

    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHES',
          action_name: 'ARCHIVE_NICHE', 
          entity_id: nicheId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('niche:NICHE_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving niche:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

