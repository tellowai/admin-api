'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

/**
 * mysql.promise.model rejects with plain objects { message, httpStatusCode, originalMessage }.
 * Passing those to next() yields Express default HTML "[object Object]" and status 500.
 */
function respondMysqlOrThrow(err, res, next) {
  if (err && typeof err === 'object' && err.httpStatusCode != null && err.message != null) {
    const body = { message: err.message };
    if (err.originalMessage) body.details = err.originalMessage;
    return res.status(err.httpStatusCode).json(body);
  }
  return next(err);
}

exports.listBffResources = async function(req, res, next) {
  try {
    const resources = await sduiDataDictionaryService.listBffResources();
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: resources });
  } catch (err) {
    return respondMysqlOrThrow(err, res, next);
  }
};

exports.createBffResource = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createBffResource(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return respondMysqlOrThrow(err, res, next);
  }
};

exports.updateBffResource = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updateBffResource(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Resource not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return respondMysqlOrThrow(err, res, next);
  }
};

exports.deleteBffResource = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deleteBffResource(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Resource not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return respondMysqlOrThrow(err, res, next);
  }
};
