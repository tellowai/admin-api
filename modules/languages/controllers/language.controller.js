'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const LanguageModel = require('../models/language.model');
const LanguageErrorHandler = require('../middlewares/language.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {get} /languages List languages
 */
exports.listLanguages = async function (req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const languages = await LanguageModel.listLanguages(paginationParams);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: languages
    });

  } catch (error) {
    logger.error('Error listing languages:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};

/**
 * @api {get} /languages/:languageId Get language
 */
exports.getLanguage = async function (req, res) {
  try {
    const { languageId } = req.params;
    const language = await LanguageModel.getLanguageById(languageId);

    if (!language) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('language:LANGUAGE_NOT_FOUND')
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: language
    });

  } catch (error) {
    logger.error('Error getting language:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};

/**
 * @api {post} /languages Create language
 */
exports.createLanguage = async function (req, res) {
  try {
    const languageData = req.validatedBody;

    // Check if language code already exists
    const existing = await LanguageModel.getLanguageByCode(languageData.code);
    if (existing) {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        message: req.t('language:LANGUAGE_CODE_EXISTS')
      });
    }

    const result = await LanguageModel.createLanguage(languageData);

    // Publish activity log
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'LANGUAGES',
          action_name: 'ADD_NEW_LANGUAGE',
          entity_id: result.insertId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('language:LANGUAGE_CREATED'),
      data: { language_id: result.insertId }
    });

  } catch (error) {
    logger.error('Error creating language:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};

/**
 * @api {patch} /languages/:languageId Update language
 */
exports.updateLanguage = async function (req, res) {
  try {
    const { languageId } = req.params;
    const languageData = req.validatedBody;

    // If updating code, check uniqueness
    if (languageData.code) {
      const existing = await LanguageModel.getLanguageByCode(languageData.code);
      if (existing && existing.language_id !== parseInt(languageId)) {
        return res.status(HTTP_STATUS_CODES.CONFLICT).json({
          message: req.t('language:LANGUAGE_CODE_EXISTS')
        });
      }
    }

    const updated = await LanguageModel.updateLanguage(languageId, languageData);

    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('language:LANGUAGE_NOT_FOUND')
      });
    }

    // Publish activity log
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'LANGUAGES',
          action_name: 'UPDATE_LANGUAGE',
          entity_id: languageId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('language:LANGUAGE_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating language:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};

/**
 * @api {post} /languages/:languageId/archive Archive language
 */
exports.archiveLanguage = async function (req, res) {
  try {
    const { languageId } = req.params;

    const archived = await LanguageModel.archiveLanguage(languageId);

    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('language:LANGUAGE_NOT_FOUND')
      });
    }

    // Publish activity log
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'LANGUAGES',
          action_name: 'ARCHIVE_LANGUAGE',
          entity_id: languageId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('language:LANGUAGE_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving language:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};

/**
 * @api {patch} /languages/:languageId/status Update language status
 */
exports.updateLanguageStatus = async function (req, res) {
  try {
    const { languageId } = req.params;
    const { status } = req.validatedBody;

    const updated = await LanguageModel.updateLanguage(languageId, { status });

    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('language:LANGUAGE_NOT_FOUND')
      });
    }

    // Publish activity log
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'LANGUAGES',
          action_name: 'UPDATE_LANGUAGE_STATUS',
          entity_id: languageId,
          details: { status }
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('language:LANGUAGE_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating language status:', { error: error.message, stack: error.stack });
    LanguageErrorHandler.handleLanguageErrors(error, res);
  }
};
