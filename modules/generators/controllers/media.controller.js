'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const MediaModel = require('../models/media.model');
const StorageFactory = require('../../os2/providers/storage.factory');
const logger = require('../../../config/lib/logger');

/**
 * @api {get} /media List all admin media
 * @apiVersion 1.0.0
 * @apiName ListAdminMedia
 * @apiGroup Media
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listAdminMedia = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const media = await MediaModel.listAdminMedia(paginationParams);

    // Get storage provider for presigned URLs
    if (media.length) {
      const storage = StorageFactory.getProvider();
      
      // Generate presigned URLs for media files
      await Promise.all(media.map(async (item) => {
        if (item.cf_r2_key) {
          item.presigned_url = await storage.generatePresignedDownloadUrl(item.cf_r2_key);
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: media
    });

  } catch (error) {
    logger.error('Error listing admin media:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Error listing admin media'
    });
  }
}; 