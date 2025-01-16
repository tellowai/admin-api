'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CollectionModel = require('../models/collection.model');
const CollectionErrorHandler = require('../middlewares/collection.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const config = require('../../../config/config');

/**
 * @api {get} /collections List collections
 * @apiVersion 1.0.0
 * @apiName ListCollections
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listCollections = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const collections = await CollectionModel.listCollections(paginationParams);

    // Generate R2 URLs if collections exist
    if (collections.length) {
      collections.forEach(collection => {
        if (collection.thumbnail_cf_r2_key) {
          collection.r2_url = `${config.os2.r2.public.bucketUrl}/${collection.thumbnail_cf_r2_key}`;
        } else {
          collection.r2_url = collection.thumbnail_cf_r2_url;
        }

        // Parse JSON fields if they are strings
        if (collection.additional_data && typeof collection.additional_data === 'string') {
          try {
            collection.additional_data = JSON.parse(collection.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: collection.additional_data
            });
          }
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: collections
    });

  } catch (error) {
    logger.error('Error listing collections:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
};

/**
 * @api {post} /collections Create collection
 * @apiVersion 1.0.0
 * @apiName CreateCollection
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiBody {String} collection_name Collection name
 * @apiBody {String} [thumbnail_cf_r2_key] Cloudflare R2 key for thumbnail
 * @apiBody {String} [thumbnail_cf_r2_url] Cloudflare R2 URL for thumbnail
 * @apiBody {Object} [additional_data] Additional collection data
 */
exports.createCollection = async function(req, res) {
  try {
    const collectionData = req.validatedBody;
    
    await CollectionModel.createCollection(collectionData);
    
    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'COLLECTIONS',
          action_name: 'ADD_NEW_COLLECTION', 
          entity_id: collectionData.collection_id
        }
      }],
      'create_admin_activity_log'
    );
  
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('collection:COLLECTION_CREATED'),
      data: { collection_id: collectionData.collection_id }
    });

  } catch (error) {
    logger.error('Error creating collection:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
};

/**
 * @api {patch} /collections/:collectionId Update collection
 * @apiVersion 1.0.0
 * @apiName UpdateCollection
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiParam {Number} collectionId Collection ID
 * @apiBody {String} [collection_name] Collection name
 * @apiBody {String} [thumbnail_cf_r2_key] Cloudflare R2 key for thumbnail
 * @apiBody {String} [thumbnail_cf_r2_url] Cloudflare R2 URL for thumbnail
 * @apiBody {Object} [additional_data] Additional collection data
 */
exports.updateCollection = async function(req, res) {
  try {
    const { collectionId } = req.params;
    const collectionData = req.validatedBody;
    
    const updated = await CollectionModel.updateCollection(collectionId, collectionData);
    
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('collection:COLLECTION_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'COLLECTIONS',
          action_name: 'UPDATE_COLLECTION', 
          entity_id: collectionId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('collection:COLLECTION_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating collection:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
};

/**
 * @api {post} /collections/:collectionId/archive Archive collection
 * @apiVersion 1.0.0
 * @apiName ArchiveCollection
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiParam {Number} collectionId Collection ID
 */
exports.archiveCollection = async function(req, res) {
  try {
    const { collectionId } = req.params;
    
    const archived = await CollectionModel.archiveCollection(collectionId);
    
    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('collection:COLLECTION_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'COLLECTIONS',
          action_name: 'ARCHIVE_COLLECTION', 
          entity_id: collectionId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('collection:COLLECTION_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving collection:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
};

/**
 * @api {get} /collections/search Search collections
 * @apiVersion 1.0.0
 * @apiName SearchCollections
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiQuery {String} q Search query
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.searchCollections = async function(req, res) {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('collection:SEARCH_QUERY_REQUIRED')
      });
    }

    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const collections = await CollectionModel.searchCollections(q, paginationParams.page, paginationParams.limit);

    // Generate R2 URLs if collections exist
    if (collections.length) {
      collections.forEach(collection => {
        if (collection.thumbnail_cf_r2_key) {
          collection.r2_url = `${config.os2.r2.public.bucketUrl}/${collection.thumbnail_cf_r2_key}`;
        } else {
          collection.r2_url = collection.thumbnail_cf_r2_url;
        }

        // Parse JSON fields if they are strings
        if (collection.additional_data && typeof collection.additional_data === 'string') {
          try {
            collection.additional_data = JSON.parse(collection.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: collection.additional_data
            });
          }
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: collections
    });

  } catch (error) {
    logger.error('Error searching collections:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
}; 