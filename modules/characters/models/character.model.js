'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { createId } = require('@paralleldrive/cuid2');

exports.createUserCharacter = async function(characterData) {
  const columns = Object.keys(characterData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(characterData).map(val => val || null);

  const query = `
    INSERT INTO user_characters (${columns.join(', ')}) 
    VALUES (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.listAdminUserCharacters = async function(pagination) {
  const query = `
    SELECT 
      user_character_id,
      character_name,
      character_gender,
      character_description,
      thumb_cf_r2_key,
      thumb_cf_r2_url,
      training_status,
      created_at,
      updated_at,
      user_id,
      created_by_admin_id
    FROM user_characters
    WHERE archived_at IS NULL
    AND user_id IS NULL AND created_by_admin_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [pagination.limit, pagination.offset]
  );
};

exports.listAllAdminCharacters = async function(userId) {
  const query = `
    SELECT 
      user_character_id,
      character_name,
      character_gender,
      character_description,
      thumb_cf_r2_key,
      thumb_cf_r2_url,
      training_status,
      created_at,
      updated_at,
      user_id,
      created_by_admin_id
    FROM user_characters
    WHERE user_id IS NULL AND created_by_admin_id IS NOT NULL
    AND archived_at IS NULL
    ORDER BY created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userId]);
};

exports.updateUserCharacter = async function(characterId, userId, updateData) {
  const setClause = Object.entries(updateData)
    .map(([key]) => `${key} = ?`)
    .join(', ');
  
  const values = [...Object.values(updateData), characterId, userId];

  const query = `
    UPDATE user_characters 
    SET ${setClause}
    WHERE user_character_id = ?
    AND user_id = ?
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
}; 

exports.verifyCharacterOwnership = async function(characterId, userId) {
  const query = `
    SELECT user_character_id 
    FROM user_characters 
    WHERE user_character_id = ? 
    AND user_id = ? 
    AND archived_at IS NULL
  `;
  
  const [character] = await mysqlQueryRunner.runQueryInSlave(query, [characterId, userId]);
  return !!character;
}; 

exports.verifyCharacterOwnershipOfMultipleCharacters = async function(characterIds) {
  const query = `
    SELECT user_character_id 
    FROM user_characters 
    WHERE user_character_id IN (?) 
    AND user_id IS NULL AND created_by_admin_id IS NOT NULL
    AND archived_at IS NULL
  `;
  
  const characters = await mysqlQueryRunner.runQueryInSlave(query, [characterIds]);
  return characters.length;
}; 

exports.getCharacterData = async function(userCharacterId) {
  const query = `
    SELECT 
      user_character_id,
      character_name,
      character_gender,
      character_description,
      thumb_cf_r2_key,
      thumb_cf_r2_url,
      trigger_word,
      user_id,
      training_status,
      created_at,
      updated_at,
      archived_at
    FROM user_characters
    WHERE user_character_id = ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userCharacterId]);
}

exports.getCharacterDataOfMultipleCharacters = async function(userCharacterIds) {
  const query = `
    SELECT 
      user_character_id,
      character_name,
      character_gender,
      character_description,
      thumb_cf_r2_key,
      thumb_cf_r2_url,
      trigger_word,
      user_id,
      training_status,
      created_at,
      updated_at,
      archived_at
    FROM user_characters
    WHERE user_character_id IN (?)
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userCharacterIds]);
}

exports.updateCharacterData = async function(userCharacterId, updateData) {
  const allowedColumns = [
    'character_name',
    'character_gender',
    'character_description', 
    'thumb_cf_r2_key',
    'thumb_cf_r2_url',
    'training_status'
  ];

  // Filter out any fields that aren't in allowed columns
  const filteredData = Object.keys(updateData)
    .filter(key => allowedColumns.includes(key))
    .reduce((obj, key) => {
      obj[key] = updateData[key];
      return obj;
    }, {});

  if (Object.keys(filteredData).length === 0) {
    return null;
  }

  const columns = Object.keys(filteredData);
  const placeholders = columns.map(col => `${col} = ?`).join(', ');
  const values = [...Object.values(filteredData), userCharacterId];

  const query = `
    UPDATE user_characters
    SET ${placeholders}
    WHERE user_character_id = ?
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getUserDataByUserId = async function(userId) {
  const query = `
    SELECT 
      user_id,
      mobile
    FROM 
      user
    WHERE 
      user_id = ?
    AND
      deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userId]);
};

exports.updateUserMobile = async function(userId, mobile) {
  const query = `
    UPDATE user
    SET mobile = ?
    WHERE user_id = ?
    AND deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [mobile, userId]);
};

exports.verifyCharacterAccess = async function(characterId, userId) {
  const query = `
    SELECT user_character_id 
    FROM user_characters 
    WHERE user_character_id = ? 
    AND (user_id = ? OR (user_id IS NULL AND created_by_admin_id IS NOT NULL))
    AND archived_at IS NULL
  `;
  
  const [character] = await mysqlQueryRunner.runQueryInSlave(query, [characterId, userId]);
  return !!character;
};


