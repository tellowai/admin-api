'use strict';

const mysqlPromiseModel = require('../../core/models/mysql.promise.model');

/**
 * Get all platforms
 */
exports.getAllPlatforms = async () => {
  const query = `
    SELECT * FROM platforms
    ORDER BY name ASC
  `;
  
  return mysqlPromiseModel.runQueryInSlave(query);
};

/**
 * Get a single platform by ID
 */
exports.getPlatformById = async (platformId) => {
  const query = `
    SELECT * FROM platforms
    WHERE platform_id = ?
  `;
  
  const results = await mysqlPromiseModel.runQueryInSlave(query, [platformId]);
  return results.length ? results[0] : null;
};

/**
 * Get a single platform by name
 */
exports.getPlatformByName = async (name) => {
  const query = `
    SELECT * FROM platforms
    WHERE name = ?
  `;
  
  const results = await mysqlPromiseModel.runQueryInSlave(query, [name]);
  return results.length ? results[0] : null;
};

/**
 * Create a new platform
 */
exports.createPlatform = async (platformData) => {
  const query = `
    INSERT INTO platforms 
    (name, description)
    VALUES (?, ?)
  `;
  
  const params = [
    platformData.name,
    platformData.description
  ];
  
  return mysqlPromiseModel.runQueryInMaster(query, params);
};

/**
 * Update a platform
 */
exports.updatePlatform = async (platformId, platformData) => {
  const updateFields = [];
  const params = [];
  
  if (platformData.name !== undefined) {
    updateFields.push('name = ?');
    params.push(platformData.name);
  }
  
  if (platformData.description !== undefined) {
    updateFields.push('description = ?');
    params.push(platformData.description);
  }
  
  if (updateFields.length === 0) {
    return { affectedRows: 0 };
  }
  
  params.push(platformId);
  
  const query = `
    UPDATE platforms
    SET ${updateFields.join(', ')}
    WHERE platform_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, params);
};

/**
 * Delete a platform
 */
exports.deletePlatform = async (platformId) => {
  const query = `
    DELETE FROM platforms
    WHERE platform_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, [platformId]);
}; 