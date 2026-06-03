'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const StorageFactory = require('../providers/storage.factory');
const { createId } = require('@paralleldrive/cuid2');
const config = require('../../../config/config');
const moment = require('moment');
const {
  insertUploadPresignedURLGeneration
} = require('../models/presigned.model');
const logger = require('../../../config/lib/logger');
const { deleteMediaRefs, normalizedMediaRef } = require('../utils/r2-orphan-cleanup.util');

/**
 * @api {post} /os2/presigned-urls Generate presigned upload URLs
 * @apiVersion 1.0.0
 * @apiName GeneratePresignedUrls
 * @apiGroup OS2
 * @apiPermission JWT
 *
 * @apiDescription Generate presigned URLs for uploading files to cloud storage (Cloudflare R2)
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {Object[]} files Array of file objects
 * @apiBody {String} files.contentType MIME type of the file (e.g., "image/jpeg")
 * @apiBody {String} [files.extension] File extension (e.g., "jpg")
 * @apiBody {Object} [files.metadata] Additional metadata for the file
 * @apiBody {Object} [files.state] State object to pass through response
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *       "files": [{
 *         "contentType": "image/jpeg",
 *         "extension": "jpg",
 *         "metadata": {
 *           "purpose": "profile_picture"
 *         },
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiSuccess {Object[]} urls Array of URL objects
 * @apiSuccess {String} urls.signed_url Complete presigned URL for upload
 * @apiSuccess {String} urls.url Base URL without signature
 * @apiSuccess {String} urls.key Object key/path in storage
 * @apiSuccess {Object} urls.state Original state object passed through
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "urls": [{
 *         "signed_url": "https://bucket.r2.cloudflarestorage.com/key?signature...",
 *         "url": "https://bucket.r2.cloudflarestorage.com/key",
 *         "key": "clh7tpzxk000008l4g0hs3j2p.jpg",
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid request data
 *
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Invalid request data"
 *     }
 */
exports.generatePresignedUrls = async function (req, res) {
  try {
    const { files } = req.validatedBody;
    const userId = req.user.userId;

    // Get storage providerx
    const storage = StorageFactory.getProvider();

    // Generate URLs for each file
    const presignedUrlData = [];
    const presignedUrls = await Promise.all(files.map(async (file) => {
      const { contentType, extension, metadata = {}, state } = file;

      // Generate unique key
      const prefix = config.os2.r2.assetsPrefix;
      const key = `${prefix}${createId()}${extension ? `.${extension}` : ''}`;

      // Generate URL
      const url = await storage.generatePresignedUploadUrl(key, {
        contentType,
        metadata: {
          ...metadata,
          userId
        },
        expiresIn: config.os2.upload.expiresIn
      });

      // Add to ClickHouse data array
      presignedUrlData.push({
        event_id: createId(),
        user_id: userId,
        object_key: key,
        content_type: contentType,
        generated_at: moment().format('YYYY-MM-DD HH:mm:ss.SSS'),
        signed_url: url,
        url: url.split('?')[0],
        expires_at: moment().add(config.os2.upload.expiresInMs, 'ms').format('YYYY-MM-DD HH:mm:ss.SSS'),
        metadata: JSON.stringify(metadata)
      });

      return {
        signed_url: url,
        url: url.split('?')[0],
        key,
        state
      };
    }));

    insertUploadPresignedURLGeneration(presignedUrlData);


    return res.status(HTTP_STATUS_CODES.OK).json({
      urls: presignedUrls
    });

  } catch (error) {
    logger.error('Error generating presigned URLs:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message || req.t('os2:PRESIGNED_URL_GENERATION_FAILED')
    });
  }
};



/**
 * @api {post} /os2/presigned-urls Generate presigned upload URLs
 * @apiVersion 1.0.0
 * @apiName GeneratePresignedUrls
 * @apiGroup OS2
 * @apiPermission JWT
 *
 * @apiDescription Generate presigned URLs for uploading files to cloud storage (Cloudflare R2)
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {Object[]} files Array of file objects
 * @apiBody {String} files.contentType MIME type of the file (e.g., "image/jpeg")
 * @apiBody {String} [files.extension] File extension (e.g., "jpg")
 * @apiBody {Object} [files.metadata] Additional metadata for the file
 * @apiBody {Object} [files.state] State object to pass through response
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *       "files": [{
 *         "contentType": "image/jpeg",
 *         "extension": "jpg",
 *         "metadata": {
 *           "purpose": "profile_picture"
 *         },
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiSuccess {Object[]} urls Array of URL objects
 * @apiSuccess {String} urls.signed_url Complete presigned URL for upload
 * @apiSuccess {String} urls.url Base URL without signature
 * @apiSuccess {String} urls.key Object key/path in storage
 * @apiSuccess {Object} urls.state Original state object passed through
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "urls": [{
 *         "signed_url": "https://bucket.r2.cloudflarestorage.com/key?signature...",
 *         "url": "https://bucket.r2.cloudflarestorage.com/key",
 *         "key": "clh7tpzxk000008l4g0hs3j2p.jpg",
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid request data
 *
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Invalid request data"
 *     }
 */
/**
 * POST /os2/presigned-read-urls — resolve existing bucket/key to a URL suitable for &lt;img&gt; / &lt;video&gt; src (public CDN or presigned GET).
 */
exports.generatePresignedReadUrls = async function (req, res) {
  try {
    const { items } = req.validatedBody;
    const storage = StorageFactory.getProvider();

    const urls = await Promise.all(
      items.map(async ({ bucket, key }) => {
        const cleanKey = key.startsWith('/') ? key.slice(1) : key;
        const signed_url = await storage.generatePresignedDownloadUrlFromBucket(bucket, cleanKey, {
          expiresIn: config.os2.download.defaultDownloadExpiresIn
        });
        return { bucket, key: cleanKey, signed_url };
      })
    );

    return res.status(HTTP_STATUS_CODES.OK).json({ urls });
  } catch (error) {
    logger.error('Error generating presigned read URLs:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message || req.t('os2:PRESIGNED_URL_GENERATION_FAILED')
    });
  }
};

exports.generatePresignedPublicBucketUrls = async function (req, res) {
  try {
    const { files } = req.validatedBody;
    const userId = req.user.userId;

    // Get storage providerx
    const storage = StorageFactory.getProvider();

    // Generate URLs for each file
    const presignedUrlData = [];
    const presignedUrls = await Promise.all(files.map(async (file) => {
      const { contentType, extension, metadata = {}, state } = file;

      // Generate unique key
      const prefix = config.os2.r2.assetsPrefix;
      const key = `${prefix}${createId()}${extension ? `.${extension}` : ''}`;

      const signedUploadUrl = await storage.generatePresignedPublicBucketUploadUrl(key, {
        contentType,
        metadata: {
          ...metadata,
          userId
        },
        expiresIn: config.os2.upload.expiresIn
      });

      const cleanKey = key.startsWith('/') ? key.slice(1) : key;
      const bucketBase = String(config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
      /** Stripped PUT URL host (R2 API). Not reliable for anonymous GET; kept for backward compatibility when CDN differs. */
      const strippedSignedBase = signedUploadUrl.split('?')[0];
      /** Primary public GET URL (CDN / custom domain). */
      const publicReadUrl = bucketBase ? `${bucketBase}/${cleanKey}` : strippedSignedBase;

      // Add to ClickHouse data array
      presignedUrlData.push({
        event_id: createId(),
        user_id: userId,
        object_key: key,
        content_type: contentType,
        generated_at: moment().format('YYYY-MM-DD HH:mm:ss.SSS'),
        signed_url: signedUploadUrl,
        url: publicReadUrl,
        expires_at: moment().add(config.os2.upload.expiresInMs, 'ms').format('YYYY-MM-DD HH:mm:ss.SSS'),
        metadata: JSON.stringify(metadata)
      });

      const responseItem = {
        signed_url: signedUploadUrl,
        url: publicReadUrl,
        key,
        state
      };
      // When CDN URL differs from stripped presigned host, expose legacy shape for callers that still expect it.
      if (publicReadUrl !== strippedSignedBase) {
        responseItem.storage_object_url = strippedSignedBase;
      }
      return responseItem;
    }));

    insertUploadPresignedURLGeneration(presignedUrlData);


    return res.status(HTTP_STATUS_CODES.OK).json({
      urls: presignedUrls
    });

  } catch (error) {
    logger.error('Error generating presigned URLs:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message || req.t('os2:PRESIGNED_URL_GENERATION_FAILED')
    });
  }
};


/**
 * @api {post} /os2/presigned-urls Generate presigned upload URLs
 * @apiVersion 1.0.0
 * @apiName GeneratePresignedUrls
 * @apiGroup OS2
 * @apiPermission JWT
 *
 * @apiDescription Generate presigned URLs for uploading files to cloud storage (Cloudflare R2)
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {Object[]} files Array of file objects
 * @apiBody {String} files.contentType MIME type of the file (e.g., "image/jpeg")
 * @apiBody {String} [files.extension] File extension (e.g., "jpg")
 * @apiBody {Object} [files.metadata] Additional metadata for the file
 * @apiBody {Object} [files.state] State object to pass through response
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *       "files": [{
 *         "contentType": "image/jpeg",
 *         "extension": "jpg",
 *         "metadata": {
 *           "purpose": "profile_picture"
 *         },
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiSuccess {Object[]} urls Array of URL objects
 * @apiSuccess {String} urls.signed_url Complete presigned URL for upload
 * @apiSuccess {String} urls.url Base URL without signature
 * @apiSuccess {String} urls.key Object key/path in storage
 * @apiSuccess {Object} urls.state Original state object passed through
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "urls": [{
 *         "signed_url": "https://bucket.r2.cloudflarestorage.com/key?signature...",
 *         "url": "https://bucket.r2.cloudflarestorage.com/key",
 *         "key": "clh7tpzxk000008l4g0hs3j2p.jpg",
 *         "state": {
 *           "type": "profile",
 *           "position": 1
 *         }
 *       }]
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid request data
 *
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Invalid request data"
 *     }
 */
exports.generateEphemeralPresignedUrls = async function (req, res) {
  try {
    const { files } = req.validatedBody;
    const userId = req.user.userId;

    // Get storage providerx
    const storage = StorageFactory.getProvider();

    // Generate URLs for each file
    const presignedUrlData = [];
    const presignedUrls = await Promise.all(files.map(async (file) => {
      const { contentType, extension, metadata = {}, state } = file;

      // Generate unique key
      const prefix = config.os2.r2.assetsPrefix;
      const key = `${prefix}${createId()}${extension ? `.${extension}` : ''}`;

      // Generate URL
      const { url, bucket } = await storage.generateEphemeralPresignedUploadUrl(key, {
        contentType,
        metadata: {
          ...metadata,
          userId
        },
        expiresIn: config.os2.upload.expiresIn
      });

      // Add to ClickHouse data array
      presignedUrlData.push({
        event_id: createId(),
        user_id: userId,
        object_key: key,
        content_type: contentType,
        generated_at: moment().format('YYYY-MM-DD HH:mm:ss.SSS'),
        signed_url: url,
        url: url.split('?')[0],
        expires_at: moment().add(config.os2.upload.expiresInMs, 'ms').format('YYYY-MM-DD HH:mm:ss.SSS'),
        metadata: JSON.stringify(metadata)
      });

      return {
        signed_url: url,
        url: url.split('?')[0],
        key,
        bucket,
        state
      };
    }));

    insertUploadPresignedURLGeneration(presignedUrlData);


    return res.status(HTTP_STATUS_CODES.OK).json({
      urls: presignedUrls
    });

  } catch (error) {
    logger.error('Error generating presigned URLs:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message || req.t('os2:PRESIGNED_URL_GENERATION_FAILED')
    });
  }
};

/**
 * @api {post} /os2/storage-objects/delete Delete objects from R2 (e.g. ephemeral studio uploads)
 */
exports.deleteStorageObjects = async function (req, res) {
  try {
    const { objects } = req.validatedBody;
    const refs = objects
      .map((obj) => normalizedMediaRef(obj.asset_bucket || 'ephemeral', obj.asset_key))
      .filter(Boolean)
      .filter((ref) => ref.bucket === 'ephemeral');
    if (refs.length !== objects.length) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Only ephemeral bucket objects can be deleted via this endpoint',
      });
    }
    if (refs.length) {
      await deleteMediaRefs(refs, 'storage_object');
    }
    return res.status(HTTP_STATUS_CODES.OK).json({ deleted_count: refs.length });
  } catch (error) {
    logger.error('Error deleting storage objects:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message || req.t('os2:STORAGE_OBJECT_DELETE_FAILED'),
    });
  }
};
