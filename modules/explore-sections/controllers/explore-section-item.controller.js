'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const ExploreSectionItemModel = require('../models/explore-section-item.model');
const ExploreSectionErrorHandler = require('../middlewares/explore-section.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const config = require('../../../config/config');

/**
 * @api {get} /explore-sections/:sectionId/items List section items
 * @apiVersion 1.0.0
 * @apiName ListSectionItems
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listSectionItems = async function(req, res) {
  try {
    const { sectionId } = req.params;
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const items = await ExploreSectionItemModel.listSectionItems(sectionId, paginationParams);

    // Separate items by resource type
    const templateIds = items
      .filter(item => item.resource_type === 'template')
      .map(item => item.resource_id);
    
    const collectionIds = items
      .filter(item => item.resource_type === 'collection')
      .map(item => item.resource_id);

    // Fetch templates and collections in parallel
    const [templates, collections] = await Promise.all([
      ExploreSectionItemModel.getTemplatesForItems(templateIds),
      ExploreSectionItemModel.getCollectionsForItems(collectionIds)
    ]);

    // Create lookup maps for faster access
    const templateMap = templates.reduce((acc, t) => {
      acc[t.template_id] = t;
      return acc;
    }, {});

    const collectionMap = collections.reduce((acc, c) => {
      acc[c.collection_id] = c;
      return acc;
    }, {});

    // Enrich items with resource data
    const enrichedItems = items.map(item => {
      const enrichedItem = { ...item };
      
      if (item.resource_type === 'template') {
        const template = templateMap[item.resource_id];
        if (template) {
          enrichedItem.resource_name = template.template_name;
          
          if(template.template_code) {
            enrichedItem.resource_code = template.template_code;
          }
          
          enrichedItem.resource_image_key = template.cf_r2_key;
          if (template.cf_r2_key) {
            enrichedItem.resource_image_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
            enrichedItem.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
          }
        }
      } else if (item.resource_type === 'collection') {
        const collection = collectionMap[item.resource_id];
        if (collection) {
          enrichedItem.resource_name = collection.collection_name;
          enrichedItem.resource_image_key = collection.resource_image_key;
          if (collection.resource_image_key) {
            enrichedItem.resource_image_url = `${config.os2.r2.public.bucketUrl}/${collection.resource_image_key}`;
            enrichedItem.r2_url = `${config.os2.r2.public.bucketUrl}/${collection.resource_image_key}`;
          }
        }
      }

      return enrichedItem;
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: enrichedItems
    });

  } catch (error) {
    logger.error('Error listing section items:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {post} /explore-sections/:sectionId/items Add items to section
 * @apiVersion 1.0.0
 * @apiName AddSectionItems
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 * @apiBody {Object[]} items Array of items to add
 * @apiBody {String} items.resource_type Type of resource ('template' or 'collection')
 * @apiBody {String} items.resource_id Resource ID (UUID)
 * @apiBody {Number} [items.sort_order] Sort order within section
 */
exports.addSectionItems = async function(req, res) {
  try {
    const items = req.validatedBody;
    
    // Check for existing items
    const existingItems = await ExploreSectionItemModel.getExistingItems(items[0].section_id, items);
    
    // Create a map of existing items
    const existingMap = existingItems.reduce((acc, item) => {
      acc[`${item.resource_type}-${item.resource_id}`] = true;
      return acc;
    }, {});

    // Prepare items with status
    const itemsWithStatus = items.map(item => ({
      ...item,
      status: existingMap[`${item.resource_type}-${item.resource_id}`] ? 'duplicate' : 'new'
    }));

    // Filter new items for insertion
    const newItems = itemsWithStatus.filter(item => item.status === 'new');

    let result = { affectedRows: 0 };
    // If there are new items to add
    if (newItems.length > 0) {
      result = await ExploreSectionItemModel.bulkInsertItems(newItems);
      
      // Update status of successfully added items
      if (result.affectedRows > 0) {
        newItems.forEach(item => {
          item.status = 'added';
        });
      }
    }

    const summary = {
      total: items.length,
      added: newItems.length,
      duplicates: existingItems.length
    };

    // If no new items were added because all were duplicates
    if (summary.added === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('explore_section:EXPLORE_SECTION_ITEMS_ALREADY_EXIST'),
        data: {
          items: itemsWithStatus,
          summary
        }
      });
    }

    // If some items were duplicates but some were added
    const message = summary.duplicates > 0
      ? req.t('explore_section:EXPLORE_SECTION_ITEMS_ADDED_WITH_DUPLICATES')
      : req.t('explore_section:EXPLORE_SECTION_ITEMS_ADDED');
    
    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTION_ITEMS',
          action_name: 'ADD_SECTION_ITEMS', 
          entity_id: items[0].section_id
        }
      }],
      'create_admin_activity_log'
    );
  
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message,
      data: {
        items: itemsWithStatus,
        summary
      }
    });

  } catch (error) {
    logger.error('Error adding section items:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {delete} /explore-sections/:sectionId/items Remove items from section
 * @apiVersion 1.0.0
 * @apiName RemoveSectionItems
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 * @apiBody {String[]} item_ids Array of item IDs to remove
 */
exports.removeSectionItems = async function(req, res) {
  try {
    const { sectionId } = req.params;
    const { item_ids } = req.validatedBody;
    
    const removed = await ExploreSectionItemModel.removeSectionItems(sectionId, item_ids);
    
    if (!removed) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('explore_section:EXPLORE_SECTION_ITEMS_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTION_ITEMS',
          action_name: 'REMOVE_SECTION_ITEMS', 
          entity_id: item_ids.join(',')
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('explore_section:EXPLORE_SECTION_ITEMS_REMOVED')
    });

  } catch (error) {
    logger.error('Error removing section items:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {post} /explore-sections/:sectionId/collection-templates Add all templates from collection
 * @apiVersion 1.0.0
 * @apiName AddCollectionTemplates
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 * @apiBody {String} collection_id Collection ID
 */
exports.addCollectionTemplates = async function(req, res) {
  try {
    const { sectionId } = req.params;
    const { collection_id } = req.validatedBody;

    // Get template IDs from collection
    const collectionTemplates = await ExploreSectionItemModel.getCollectionTemplateIds(collection_id);

    if (!collectionTemplates.length) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('explore_section:COLLECTION_HAS_NO_TEMPLATES')
      });
    }

    // Prepare items for adding to section
    const items = collectionTemplates.map(template => ({
      section_id: parseInt(sectionId),
      resource_type: 'template',
      resource_id: template.template_id
    }));

    // Check for existing items
    const existingItems = await ExploreSectionItemModel.getExistingItems(sectionId, items);
    
    // Create a map of existing items
    const existingMap = existingItems.reduce((acc, item) => {
      acc[`${item.resource_type}-${item.resource_id}`] = true;
      return acc;
    }, {});

    // Prepare items with status
    const itemsWithStatus = items.map(item => ({
      ...item,
      status: existingMap[`${item.resource_type}-${item.resource_id}`] ? 'duplicate' : 'new'
    }));

    // Filter new items for insertion
    const newItems = itemsWithStatus.filter(item => item.status === 'new');

    let result = { affectedRows: 0 };
    // If there are new items to add
    if (newItems.length > 0) {
      result = await ExploreSectionItemModel.bulkInsertItems(newItems);
      
      // Update status of successfully added items
      if (result.affectedRows > 0) {
        newItems.forEach(item => {
          item.status = 'added';
        });
      }
    }

    const summary = {
      total: items.length,
      added: newItems.length,
      duplicates: existingItems.length
    };

    // If no new items were added because all were duplicates
    if (summary.added === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('explore_section:EXPLORE_SECTION_ITEMS_ALREADY_EXIST'),
        data: {
          items: itemsWithStatus,
          summary
        }
      });
    }

    // If some items were duplicates but some were added
    const message = summary.duplicates > 0
      ? req.t('explore_section:EXPLORE_SECTION_ITEMS_ADDED_WITH_DUPLICATES')
      : req.t('explore_section:EXPLORE_SECTION_ITEMS_ADDED');
    
    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTION_ITEMS',
          action_name: 'ADD_COLLECTION_TEMPLATES', 
          entity_id: sectionId,
          collection_id: collection_id
        }
      }],
      'create_admin_activity_log'
    );
  
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message,
      data: {
        items: itemsWithStatus,
        summary
      }
    });

  } catch (error) {
    logger.error('Error adding collection templates to section:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
}; 