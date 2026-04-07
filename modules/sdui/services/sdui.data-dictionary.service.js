'use strict';

const dataDictionaryModel = require('../models/sdui.data-dictionary.model');
const bffResourcesModel = require('../models/sdui.bff-resources.model');
const presentationRulesModel = require('../models/sdui.presentation-rules.model');
const formattersModel = require('../models/sdui.formatters.model');
const dataBindingsModel = require('../models/sdui.data-bindings.model');

// --- Data Dictionary ---
exports.listDataDictionaryFields = async (resourceKey) => {
  return dataDictionaryModel.listDataDictionaryFields(resourceKey);
};
exports.createDataDictionaryField = async (data) => {
  return dataDictionaryModel.createDataDictionaryField(data);
};
exports.updateDataDictionaryField = async (id, data) => {
  return dataDictionaryModel.updateDataDictionaryField(id, data);
};
exports.deleteDataDictionaryField = async (id) => {
  return dataDictionaryModel.deleteDataDictionaryField(id);
};

// --- BFF Resources ---
exports.listBffResources = async () => {
  return bffResourcesModel.listBffResources();
};
exports.createBffResource = async (data) => {
  return bffResourcesModel.createBffResource(data);
};
exports.updateBffResource = async (id, data) => {
  return bffResourcesModel.updateBffResource(id, data);
};
exports.deleteBffResource = async (id) => {
  return bffResourcesModel.deleteBffResource(id);
};

// --- Presentation Rules ---
exports.getPresentationRules = async (resourceKey) => {
  return presentationRulesModel.getPresentationRules(resourceKey);
};
exports.createPresentationRule = async (data) => {
  return presentationRulesModel.createPresentationRule(data);
};
exports.updatePresentationRule = async (id, data) => {
  return presentationRulesModel.updatePresentationRule(id, data);
};
exports.deletePresentationRule = async (id) => {
  return presentationRulesModel.deletePresentationRule(id);
};

// --- Formatters ---
exports.getFormatters = async (resourceKey) => {
  return formattersModel.getFormatters(resourceKey);
};
exports.createFormatter = async (data) => {
  return formattersModel.createFormatter(data);
};
exports.updateFormatter = async (id, data) => {
  return formattersModel.updateFormatter(id, data);
};
exports.deleteFormatter = async (id) => {
  return formattersModel.deleteFormatter(id);
};

// --- Data Bindings ---
exports.getDataBindingsForEntity = async (entityType, entityId) => {
  return dataBindingsModel.getDataBindingsForEntity(entityType, entityId);
};
exports.createDataBinding = async (data) => {
  return dataBindingsModel.createDataBinding(data);
};
exports.updateDataBinding = async (id, data) => {
  return dataBindingsModel.updateDataBinding(id, data);
};
exports.deleteDataBinding = async (id) => {
  return dataBindingsModel.deleteDataBinding(id);
};
