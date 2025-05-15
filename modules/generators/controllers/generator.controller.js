'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const GeneratorModel = require('../models/generator.model');
const GeneratorErrorHandler = require('../middlewares/generator.error.handler');


exports.deleteGeneration = async function(req, res) {
  try {
    const userId = req.user.userId;
    const { media_id } = req.params;

    // Soft delete the media file
    await GeneratorModel.deleteMediaFile(media_id, userId);

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('generator:GENERATION_DELETED')
    });

  } catch (error) {
    logger.error('Error deleting generation:', { error: error.message, stack: error.stack });
    GeneratorErrorHandler.handleGeneratorDeleteErrors(error, res);
  }
}; 