'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

exports.getFormatters = async function(req, res, next) {
  try {
    const formatters = await sduiDataDictionaryService.getFormatters(req.params.resourceKey);
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: formatters });
  } catch (err) {
    return next(err);
  }
};

exports.createFormatter = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createFormatter(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return next(err);
  }
};

exports.updateFormatter = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updateFormatter(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Formatter not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return next(err);
  }
};

exports.deleteFormatter = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deleteFormatter(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Formatter not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return next(err);
  }
};
