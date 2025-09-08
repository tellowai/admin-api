'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const ExploreSectionModel = require('../models/explore-section.model');
const ExploreSectionErrorHandler = require('../middlewares/explore-section.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {get} /explore-sections List explore sections
 * @apiVersion 1.0.0
 * @apiName ListExploreSections
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listExploreSections = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const sections = await ExploreSectionModel.listExploreSections(paginationParams);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: sections
    });

  } catch (error) {
    logger.error('Error listing explore sections:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {post} /explore-sections Create explore section
 * @apiVersion 1.0.0
 * @apiName CreateExploreSection
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiBody {String} section_name Section name
 * @apiBody {String} [layout_type=horizontal_scroller] Layout type
 * @apiBody {String} [section_items_type=manual] Section items type
 * @apiBody {String} [section_type=mixed] Section type
 * @apiBody {String} [ui_type=normal] UI type
 * @apiBody {Number} [sort_order=0] Sort order
 * @apiBody {String} [status=active] Section status
 * @apiBody {Object} [additional_data] Additional section data
 */
exports.createExploreSection = async function(req, res) {
  try {
    const sectionData = req.validatedBody;
    const result = await ExploreSectionModel.createExploreSection(sectionData);
    
    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTIONS',
          action_name: 'ADD_NEW_EXPLORE_SECTION', 
          entity_id: result.insertId
        }
      }],
      'create_admin_activity_log'
    );
  
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('explore_section:EXPLORE_SECTION_CREATED'),
      data: { section_id: result.insertId }
    });

  } catch (error) {
    logger.error('Error creating explore section:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {patch} /explore-sections/:sectionId Update explore section
 * @apiVersion 1.0.0
 * @apiName UpdateExploreSection
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 * @apiBody {String} [section_name] Section name
 * @apiBody {String} [layout_type] Layout type
 * @apiBody {String} [section_items_type] Section items type
 * @apiBody {String} [section_type] Section type
 * @apiBody {String} [ui_type] UI type
 * @apiBody {Number} [sort_order] Sort order
 * @apiBody {String} [status] Section status
 * @apiBody {Object} [additional_data] Additional section data
 */
exports.updateExploreSection = async function(req, res) {
  try {
    const { sectionId } = req.params;
    const sectionData = req.validatedBody;
    
    const updated = await ExploreSectionModel.updateExploreSection(sectionId, sectionData);
    
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('explore_section:EXPLORE_SECTION_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTIONS',
          action_name: 'UPDATE_EXPLORE_SECTION', 
          entity_id: sectionId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('explore_section:EXPLORE_SECTION_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating explore section:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {post} /explore-sections/:sectionId/archive Archive explore section
 * @apiVersion 1.0.0
 * @apiName ArchiveExploreSection
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiParam {Number} sectionId Section ID
 */
exports.archiveExploreSection = async function(req, res) {
  try {
    const { sectionId } = req.params;
    
    const archived = await ExploreSectionModel.archiveExploreSection(sectionId);
    
    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('explore_section:EXPLORE_SECTION_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTIONS',
          action_name: 'ARCHIVE_EXPLORE_SECTION', 
          entity_id: sectionId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('explore_section:EXPLORE_SECTION_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving explore section:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
};

/**
 * @api {patch} /explore-sections/sort-order Update sort order
 * @apiVersion 1.0.0
 * @apiName UpdateSortOrder
 * @apiGroup ExploreSections
 * @apiPermission JWT
 *
 * @apiBody {Object[]} sections Sections with updated sort orders
 * @apiBody {Number} sections.section_id Section ID
 * @apiBody {Number} sections.sort_order New sort order
 */
exports.updateSortOrder = async function(req, res) {
  try {
    const sortOrderUpdates = req.validatedBody;
    
    await ExploreSectionModel.updateSortOrders(sortOrderUpdates);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'EXPLORE_SECTIONS',
          action_name: 'UPDATE_EXPLORE_SECTIONS_SORT_ORDER',
          entity_id: sortOrderUpdates.map(u => u.section_id).join(',')
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('explore_section:EXPLORE_SECTION_SORT_ORDER_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating explore sections sort order:', { error: error.message, stack: error.stack });
    ExploreSectionErrorHandler.handleExploreSectionErrors(error, res);
  }
}; 