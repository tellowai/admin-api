'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CollectionModel = require('../models/collection.model');
const CollectionTemplateModel = require('../models/collection-template.model');
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

/**
 * @api {post} /collections/:collectionId/templates Add templates to collection
 * @apiVersion 1.0.0
 * @apiName AddTemplates
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiParam {Number} collectionId Collection ID
 * @apiBody {Array} template_ids Array of template IDs to add to the collection
 */
exports.addTemplates = async function(req, res) {
  try {
    const { collectionId } = req.params;
    const { template_ids } = req.validatedBody;
    
    // Check if collection exists
    const collectionExists = await CollectionTemplateModel.checkCollectionExists(collectionId);
    if (!collectionExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('collection:COLLECTION_NOT_FOUND')
      });
    }

    // Get existing templates
    const existingTemplates = await CollectionTemplateModel.checkTemplatesExist(template_ids);
    const existingTemplateIds = existingTemplates.map(t => t.template_id);
    const nonExistingTemplateIds = template_ids.filter(id => !existingTemplateIds.includes(id));

    // Check which templates are already in collection
    const templatesInCollection = await CollectionTemplateModel.checkTemplatesNotInCollection(collectionId, existingTemplateIds);
    const alreadyInCollectionIds = templatesInCollection.map(t => t.template_id);
    const toAddTemplateIds = existingTemplateIds.filter(id => !alreadyInCollectionIds.includes(id));

    // Only proceed if we have templates to add
    if (toAddTemplateIds.length > 0) {
      await CollectionTemplateModel.addTemplatesToCollection(collectionId, toAddTemplateIds);

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'COLLECTIONS',
            action_name: 'ADD_TEMPLATES_TO_COLLECTION', 
            entity_id: collectionId
          }
        }],
        'create_admin_activity_log'
      );
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('collection:TEMPLATES_ADDED_TO_COLLECTION'),
      data: {
        added_templates: toAddTemplateIds,
        already_in_collection: alreadyInCollectionIds,
        non_existing_templates: nonExistingTemplateIds
      }
    });

  } catch (error) {
    logger.error('Error adding templates to collection:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
};

/**
 * @api {post} /collections/templates Add templates to multiple collections
 * @apiVersion 1.0.0
 * @apiName AddTemplatesToCollections
 * @apiGroup Collections
 * @apiPermission JWT
 *
 * @apiBody {Array} template_ids Array of template IDs to add
 * @apiBody {Array} collection_ids Array of collection IDs to add templates to
 */
exports.addTemplatesToCollections = async function(req, res) {
  try {
    const { template_ids, collection_ids } = req.validatedBody;
    
    // Check if collections exist
    const existingCollections = await CollectionTemplateModel.checkCollectionsExist(collection_ids);
    const existingCollectionIds = existingCollections.map(c => c.collection_id);
    const nonExistingCollectionIds = collection_ids.filter(id => !existingCollectionIds.includes(id));

    if (existingCollectionIds.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('collection:COLLECTIONS_NOT_FOUND')
      });
    }

    // Get existing templates
    const existingTemplates = await CollectionTemplateModel.checkTemplatesExist(template_ids);
    const existingTemplateIds = existingTemplates.map(t => t.template_id);
    const nonExistingTemplateIds = template_ids.filter(id => !existingTemplateIds.includes(id));

    if (existingTemplateIds.length === 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('collection:INVALID_TEMPLATES')
      });
    }

    // Check which templates are already in collections
    const templatesInCollections = await CollectionTemplateModel.checkTemplatesNotInCollections(existingCollectionIds, existingTemplateIds);
    
    // Create a map of collection_id -> template_ids that are already in that collection
    const existingMap = new Map();
    templatesInCollections.forEach(item => {
      if (!existingMap.has(item.collection_id)) {
        existingMap.set(item.collection_id, new Set());
      }
      existingMap.get(item.collection_id).add(item.template_id);
    });

    // Filter out templates that are already in collections
    const toAddCollectionIds = [];
    const toAddTemplateIds = [];
    const alreadyInCollections = [];

    existingCollectionIds.forEach(collectionId => {
      const existingTemplatesInCollection = existingMap.get(collectionId) || new Set();
      const templatesToAdd = existingTemplateIds.filter(templateId => !existingTemplatesInCollection.has(templateId));
      
      if (templatesToAdd.length > 0) {
        templatesToAdd.forEach(templateId => {
          toAddCollectionIds.push(collectionId);
          toAddTemplateIds.push(templateId);
        });
      }

      const alreadyExisting = existingTemplateIds.filter(templateId => existingTemplatesInCollection.has(templateId));
      if (alreadyExisting.length > 0) {
        alreadyInCollections.push({
          collection_id: collectionId,
          template_ids: alreadyExisting
        });
      }
    });

    // Only proceed if we have templates to add
    if (toAddCollectionIds.length > 0) {
      await CollectionTemplateModel.addTemplatesToCollections(toAddCollectionIds, toAddTemplateIds);

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'COLLECTIONS',
            action_name: 'ADD_TEMPLATES_TO_COLLECTIONS', 
            entity_id: collection_ids.join(',')
          }
        }],
        'create_admin_activity_log'
      );
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('collection:TEMPLATES_ADDED_TO_COLLECTIONS'),
      data: {
        successful_operations: {
          collection_ids: [...new Set(toAddCollectionIds)],
          template_ids: [...new Set(toAddTemplateIds)]
        },
        already_in_collections: alreadyInCollections,
        non_existing_collections: nonExistingCollectionIds,
        non_existing_templates: nonExistingTemplateIds
      }
    });

  } catch (error) {
    logger.error('Error adding templates to collections:', { error: error.message, stack: error.stack });
    CollectionErrorHandler.handleCollectionErrors(error, res);
  }
}; 