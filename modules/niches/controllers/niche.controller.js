'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const NicheModel = require('../models/niche.model');
const NicheErrorHandler = require('../middlewares/niche.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const {
  cleanupReplacedFields,
  deleteMediaRefs,
  normalizedMediaRef,
} = require('../../os2/utils/r2-orphan-cleanup.util');
const StorageFactory = require('../../os2/providers/storage.factory');
const config = require('../../../config/config');
const {
  normalizePaywallTitleTemplates,
  serializePaywallTitleTemplatesForDb,
} = require('../utils/paywallTitleTemplates.util');

function formatNichePaywallTemplates(niche) {
  if (!niche) return niche;
  return {
    ...niche,
    paywall_title_template: normalizePaywallTitleTemplates(niche.paywall_title_template),
    ai_paywall_title_template: normalizePaywallTitleTemplates(niche.ai_paywall_title_template),
  };
}

function prepareNichePaywallTemplatesForDb(nicheData) {
  const next = { ...nicheData };
  if (Object.prototype.hasOwnProperty.call(next, 'paywall_title_template')) {
    next.paywall_title_template = serializePaywallTitleTemplatesForDb(next.paywall_title_template);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'ai_paywall_title_template')) {
    next.ai_paywall_title_template = serializePaywallTitleTemplatesForDb(next.ai_paywall_title_template);
  }
  return next;
}

/**
 * Resolve full GET URL for niche thumbnail (public CDN, ephemeral presign, or private presign).
 */
async function resolveThumbUrl(bucket, assetKey) {
  if (!bucket || !assetKey) {
    return null;
  }
  const key = String(assetKey).replace(/^\//, '');
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key;
  }
  try {
    const storage = StorageFactory.getProvider();
    const ephemeralName = config.os2?.r2?.ephemeral?.bucket;
    if (ephemeralName && bucket === ephemeralName) {
      return await storage.generateEphemeralPresignedDownloadUrl(key);
    }
    const publicCfg = config.os2?.r2?.public || {};
    const publicBase = String(publicCfg.bucketUrl || '').replace(/\/$/, '');
    const publicBucketName = publicCfg.bucket;
    const isPublicBucket =
      bucket === 'public' || (publicBucketName && bucket === publicBucketName);
    if (isPublicBucket) {
      if (!publicBase) {
        return null;
      }
      return `${publicBase}/${key}`;
    }
    return await storage.generatePresignedDownloadUrl(key);
  } catch (error) {
    logger.error('Error resolving niche thumb URL:', { error: error.message, bucket, assetKey });
    return null;
  }
}

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

    const data = await Promise.all(
      niches.map(async (row) => {
        const thumb_image_url = await resolveThumbUrl(
          row.thumb_image_storage_bucket,
          row.thumb_image_object_key
        );
        return formatNichePaywallTemplates({ ...row, thumb_image_url });
      })
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data
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
    const nicheData = prepareNichePaywallTemplatesForDb(req.validatedBody);

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

    const thumb_image_url = await resolveThumbUrl(
      niche.thumb_image_storage_bucket,
      niche.thumb_image_object_key
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: formatNichePaywallTemplates({ ...niche, thumb_image_url })
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
    const nicheData = prepareNichePaywallTemplatesForDb(req.validatedBody);

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

    await cleanupReplacedFields(existingNiche, nicheData, [
      {
        keyKey: 'thumb_image_object_key',
        bucketKey: 'thumb_image_storage_bucket',
        defaultBucket: 'public',
        label: 'niche_thumbnail',
      },
    ]);

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
    const existing = await NicheModel.getNicheById(nicheId);

    const archived = await NicheModel.archiveNiche(nicheId);

    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    if (existing?.thumb_image_object_key) {
      await deleteMediaRefs(
        normalizedMediaRef(existing.thumb_image_storage_bucket, existing.thumb_image_object_key),
        'niche_thumbnail'
      );
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

