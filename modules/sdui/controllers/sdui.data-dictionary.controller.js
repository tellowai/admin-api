'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

exports.listDataDictionaryFields = async function(req, res, next) {
  try {
    const { resourceKey } = req.query;
    const fields = await sduiDataDictionaryService.listDataDictionaryFields(resourceKey);
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: fields });
  } catch (err) {
    return next(err);
  }
};

exports.createDataDictionaryField = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createDataDictionaryField(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return next(err);
  }
};

exports.updateDataDictionaryField = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updateDataDictionaryField(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Field not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return next(err);
  }
};

exports.deleteDataDictionaryField = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deleteDataDictionaryField(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Field not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return next(err);
  }
};
