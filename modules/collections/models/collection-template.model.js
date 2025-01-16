'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.addTemplatesToCollection = async function(collectionId, templateIds) {
  // Prepare values for bulk insert
  const values = [];
  const placeholders = [];

  templateIds.forEach(templateId => {
    values.push(collectionId, templateId);
    placeholders.push('(?, ?, NULL)');
  });

  const insertQuery = `
    INSERT INTO collection_templates (
      collection_id,
      template_id,
      sort_order
    ) VALUES ${placeholders.join(', ')}
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.addTemplatesToCollections = async function(collectionIds, templateIds) {
  // Prepare values for bulk insert
  const values = [];
  const placeholders = [];

  collectionIds.forEach(collectionId => {
    templateIds.forEach(templateId => {
      values.push(collectionId, templateId);
      placeholders.push('(?, ?, NULL)');
    });
  });

  const insertQuery = `
    INSERT INTO collection_templates (
      collection_id,
      template_id,
      sort_order
    ) VALUES ${placeholders.join(', ')}
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.checkCollectionsExist = async function(collectionIds) {
  const query = `
    SELECT collection_id
    FROM collections
    WHERE collection_id IN (?)
    AND archived_at IS NULL
  `;

  const existingCollections = await mysqlQueryRunner.runQueryInSlave(query, [collectionIds]);
  return existingCollections;
};

exports.checkCollectionExists = async function(collectionId) {
  const query = `
    SELECT collection_id
    FROM collections
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const [collection] = await mysqlQueryRunner.runQueryInSlave(query, [collectionId]);
  return !!collection;
};

exports.checkTemplatesExist = async function(templateIds) {
  const query = `
    SELECT template_id
    FROM templates
    WHERE template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
  return existingTemplates;
};

exports.checkTemplatesNotInCollections = async function(collectionIds, templateIds) {
  const query = `
    SELECT collection_id, template_id
    FROM collection_templates
    WHERE collection_id IN (?)
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [collectionIds, templateIds]);
  return existingTemplates;
};

exports.checkTemplatesNotInCollection = async function(collectionId, templateIds) {
  const query = `
    SELECT template_id
    FROM collection_templates
    WHERE collection_id = ?
    AND template_id IN (?)
    AND archived_at IS NULL
  `;

  const existingTemplates = await mysqlQueryRunner.runQueryInSlave(query, [collectionId, templateIds]);
  return existingTemplates;
}; 