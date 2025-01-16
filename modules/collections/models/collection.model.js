'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listCollections = async function(pagination) {
  const query = `
    SELECT 
      collection_id,
      collection_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data,
      created_at
    FROM collections
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [pagination.limit, pagination.offset]
  );
}; 

exports.getCollectionById = async function(collectionId) {
  const query = `
    SELECT 
      collection_id,
      collection_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data,
      created_at
    FROM collections
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const [collection] = await mysqlQueryRunner.runQueryInSlave(query, [collectionId]);
  return collection;
};

exports.searchCollections = async function(searchQuery, page, limit) {
  const offset = (page - 1) * limit;
  
  const query = `
    SELECT 
      collection_id,
      collection_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data,
      created_at
    FROM collections
    WHERE archived_at IS NULL
    AND LOWER(collection_name) LIKE LOWER(?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const searchPattern = `%${searchQuery}%`;
  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [searchPattern, limit, offset]
  );
};

exports.createCollection = async function(collectionData) {
  // Filter out undefined values and prepare fields and values
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(collectionData).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(key);
      values.push(value === null ? null : 
        key === 'additional_data' ? JSON.stringify(value) : value);
      placeholders.push('?');
    }
  });

  const insertQuery = `
    INSERT INTO collections (
      ${fields.join(', ')}
    ) VALUES (${placeholders.join(', ')})
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.updateCollection = async function(collectionId, collectionData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(collectionData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value === null ? null : 
        key === 'additional_data' ? JSON.stringify(value) : value);
    }
  });

  // Add collectionId to values array
  values.push(collectionId);

  const query = `
    UPDATE collections 
    SET ${setClause.join(', ')}
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.archiveCollection = async function(collectionId) {
  const query = `
    UPDATE collections 
    SET archived_at = NOW()
    WHERE collection_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [collectionId]);
  return result.affectedRows > 0;
}; 