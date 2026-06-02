'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CustomersLanguagesService = require('../services/customers.languages.service');
const logger = require('../../../config/lib/logger');

exports.getContentLanguageOptedStats = async function (req, res) {
  try {
    const { start_date, end_date, tz } = req.validatedQuery || req.query;
    const { languages, summary } = await CustomersLanguagesService.getContentLanguageOptedStats({
      start_date,
      end_date,
      tz,
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ data: languages, summary });
  } catch (err) {
    logger.error('getContentLanguageOptedStats failed', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN'),
    });
  }
};
