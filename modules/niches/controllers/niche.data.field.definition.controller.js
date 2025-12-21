'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const NicheDataFieldDefinitionModel = require('../models/niche.data.field.definition.model');
const NicheModel = require('../models/niche.model');
const NicheErrorHandler = require('../middlewares/niche.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {get} /niches/:nicheId/field-definitions List niche data field definitions
 * @apiVersion 1.0.0
 * @apiName ListNicheDataFieldDefinitions
 * @apiGroup NicheDataFieldDefinitions
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listNicheDataFieldDefinitions = async function(req, res) {
  try {
    const { nicheId } = req.params;

    // Check if niche exists
    const nicheExists = await NicheModel.checkNicheExists(nicheId);
    if (!nicheExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const fieldDefinitions = await NicheDataFieldDefinitionModel.listNicheDataFieldDefinitions(nicheId, paginationParams);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: fieldDefinitions
    });

  } catch (error) {
    logger.error('Error listing niche data field definitions:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {post} /niches/:nicheId/field-definitions/bulk Add bulk field definitions to niche
 * @apiVersion 1.0.0
 * @apiName BulkCreateNicheDataFieldDefinitions
 * @apiGroup NicheDataFieldDefinitions
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiBody {Array} fields Array of field definition objects
 * @apiBody {String} fields[].field_code Field code
 * @apiBody {String} fields[].field_label Field label
 * @apiBody {String} fields[].field_data_type Field data type (short_text, long_text, date, time, datetime, photo, video)
 * @apiBody {Boolean} [fields[].is_visible_in_first_time_flow=false] Whether field is visible in first time flow
 * @apiBody {Number} [fields[].display_order] Display order
 */
exports.bulkCreateNicheDataFieldDefinitions = async function(req, res) {
  try {
    const { nicheId } = req.params;
    const { fields } = req.validatedBody;

    // Check if niche exists
    const nicheExists = await NicheModel.checkNicheExists(nicheId);
    if (!nicheExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Add niche_id to each field
    const fieldsData = fields.map(field => ({
      ...field,
      niche_id: nicheId
    }));

    const result = await NicheDataFieldDefinitionModel.bulkCreateNicheDataFieldDefinitions(fieldsData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHE_DATA_FIELD_DEFINITIONS',
          action_name: 'BULK_ADD_FIELD_DEFINITIONS', 
          entity_id: nicheId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('niche:FIELD_DEFINITIONS_CREATED'),
      data: {
        created_count: result.affectedRows,
        field_definition_ids: result.insertIds
      }
    });

  } catch (error) {
    logger.error('Error bulk creating niche data field definitions:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {patch} /niches/:nicheId/field-definitions/bulk Update bulk field definitions
 * @apiVersion 1.0.0
 * @apiName BulkUpdateNicheDataFieldDefinitions
 * @apiGroup NicheDataFieldDefinitions
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiBody {Array} fields Array of field definition objects to update
 * @apiBody {Number} fields[].ndfd_id Field definition ID (required)
 * @apiBody {String} [fields[].field_label] Field label
 * @apiBody {String} [fields[].field_data_type] Field data type
 * @apiBody {Boolean} [fields[].is_visible_in_first_time_flow] Whether field is visible in first time flow
 * @apiBody {Number} [fields[].display_order] Display order
 * @apiNote field_code is not updatable after creation
 */
exports.bulkUpdateNicheDataFieldDefinitions = async function(req, res) {
  try {
    const { nicheId } = req.params;
    const { fields } = req.validatedBody;

    // Check if niche exists
    const nicheExists = await NicheModel.checkNicheExists(nicheId);
    if (!nicheExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Validate that all field definitions belong to this niche
    const ndfdIds = fields.filter(f => f.ndfd_id).map(f => f.ndfd_id);
    if (ndfdIds.length > 0) {
      const existingFields = await NicheDataFieldDefinitionModel.getNicheDataFieldDefinitionsByIds(ndfdIds);
      const invalidFields = existingFields.filter(f => f.niche_id !== parseInt(nicheId));
      
      if (invalidFields.length > 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('niche:INVALID_FIELD_DEFINITIONS_FOR_NICHE')
        });
      }
    }

    // Remove field_code from all fields - it's not updatable
    const fieldsWithoutCode = fields.map(({ field_code, ...rest }) => rest);

    const updatedCount = await NicheDataFieldDefinitionModel.bulkUpdateNicheDataFieldDefinitions(fieldsWithoutCode);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHE_DATA_FIELD_DEFINITIONS',
          action_name: 'BULK_UPDATE_FIELD_DEFINITIONS', 
          entity_id: nicheId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('niche:FIELD_DEFINITIONS_UPDATED'),
      data: {
        updated_count: updatedCount
      }
    });

  } catch (error) {
    logger.error('Error bulk updating niche data field definitions:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {post} /niches/:nicheId/field-definitions/:ndfdId/archive Archive field definition
 * @apiVersion 1.0.0
 * @apiName ArchiveNicheDataFieldDefinition
 * @apiGroup NicheDataFieldDefinitions
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiParam {Number} ndfdId Field definition ID
 */
exports.archiveNicheDataFieldDefinition = async function(req, res) {
  try {
    const { nicheId, ndfdId } = req.params;

    // Check if niche exists
    const nicheExists = await NicheModel.checkNicheExists(nicheId);
    if (!nicheExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Check if field definition exists and belongs to this niche
    const fieldDefinition = await NicheDataFieldDefinitionModel.getNicheDataFieldDefinitionById(ndfdId);
    if (!fieldDefinition) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:FIELD_DEFINITION_NOT_FOUND')
      });
    }

    if (fieldDefinition.niche_id !== parseInt(nicheId)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('niche:INVALID_FIELD_DEFINITION_FOR_NICHE')
      });
    }

    const archived = await NicheDataFieldDefinitionModel.archiveNicheDataFieldDefinition(ndfdId);

    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:FIELD_DEFINITION_NOT_FOUND')
      });
    }

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'NICHE_DATA_FIELD_DEFINITIONS',
          action_name: 'ARCHIVE_FIELD_DEFINITION', 
          entity_id: ndfdId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('niche:FIELD_DEFINITION_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving niche data field definition:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

/**
 * @api {post} /niches/:nicheId/field-definitions/archive/bulk Bulk archive field definitions
 * @apiVersion 1.0.0
 * @apiName BulkArchiveNicheDataFieldDefinitions
 * @apiGroup NicheDataFieldDefinitions
 * @apiPermission JWT
 *
 * @apiParam {Number} nicheId Niche ID
 * @apiBody {Array} ndfd_ids Array of field definition IDs
 */
exports.bulkArchiveNicheDataFieldDefinitions = async function(req, res) {
  try {
    const { nicheId } = req.params;
    const { ndfd_ids } = req.validatedBody;

    // Check if niche exists
    const nicheExists = await NicheModel.checkNicheExists(nicheId);
    if (!nicheExists) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NICHE_NOT_FOUND')
      });
    }

    // Validate that all field definitions belong to this niche
    const existingFields = await NicheDataFieldDefinitionModel.getNicheDataFieldDefinitionsByIds(ndfd_ids);
    const invalidFields = existingFields.filter(f => f.niche_id !== parseInt(nicheId));
    
    if (invalidFields.length > 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('niche:INVALID_FIELD_DEFINITIONS_FOR_NICHE')
      });
    }

    const archivedCount = await NicheDataFieldDefinitionModel.bulkArchiveNicheDataFieldDefinitions(ndfd_ids);

    if (archivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('niche:NO_FIELD_DEFINITIONS_ARCHIVED')
      });
    }

    // Publish activity log command for each archived field
    const activityLogCommands = ndfd_ids.map(ndfdId => ({
      value: { 
        admin_user_id: req.user.userId,
        entity_type: 'NICHE_DATA_FIELD_DEFINITIONS',
        action_name: 'BULK_ARCHIVE_FIELD_DEFINITION', 
        entity_id: ndfdId
      }
    }));

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      activityLogCommands,
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('niche:FIELD_DEFINITIONS_BULK_ARCHIVED'),
      data: {
        archived_count: archivedCount,
        total_requested: ndfd_ids.length
      }
    });

  } catch (error) {
    logger.error('Error bulk archiving niche data field definitions:', { error: error.message, stack: error.stack });
    NicheErrorHandler.handleNicheErrors(error, res);
  }
};

