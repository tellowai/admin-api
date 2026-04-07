'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

exports.listBffResources = async function(req, res, next) {
  try {
    const resources = await sduiDataDictionaryService.listBffResources();
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: resources });
  } catch (err) {
    return next(err);
  }
};

exports.createBffResource = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createBffResource(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return next(err);
  }
};

exports.updateBffResource = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updateBffResource(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Resource not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return next(err);
  }
};

exports.deleteBffResource = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deleteBffResource(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Resource not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return next(err);
  }
};
