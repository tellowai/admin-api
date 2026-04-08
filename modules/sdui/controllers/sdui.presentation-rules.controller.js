'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const sduiDataDictionaryService = require('../services/sdui.data-dictionary.service');

exports.getPresentationRules = async function(req, res, next) {
  try {
    const rules = await sduiDataDictionaryService.getPresentationRules(req.params.resourceKey);
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'OK', data: rules });
  } catch (err) {
    return next(err);
  }
};

exports.createPresentationRule = async function(req, res, next) {
  try {
    const id = await sduiDataDictionaryService.createPresentationRule(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ message: 'Created', data: { id } });
  } catch (err) {
    return next(err);
  }
};

exports.updatePresentationRule = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.updatePresentationRule(req.params.id, req.body);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Rule not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Updated' });
  } catch (err) {
    return next(err);
  }
};

exports.deletePresentationRule = async function(req, res, next) {
  try {
    const success = await sduiDataDictionaryService.deletePresentationRule(req.params.id);
    if (!success) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Rule not found' });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (err) {
    return next(err);
  }
};
