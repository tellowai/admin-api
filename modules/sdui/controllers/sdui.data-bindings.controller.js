'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

exports.getDataBindingsForEntity = async function(req, res, next) {
  try {
    const { entityType, entityId } = req.params;
    const bindings = await sduiDataDictionaryService.getDataBindingsForEntity(entityType, entityId);
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: bindings });
  } catch (err) {
    return next(err);
  }
};

exports.createDataBinding = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createDataBinding(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return next(err);
  }
};

exports.updateDataBinding = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updateDataBinding(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Binding not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return next(err);
  }
};

exports.deleteDataBinding = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deleteDataBinding(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Binding not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return next(err);
  }
};
