'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { createId } = require('@paralleldrive/cuid2');

exports.uploadMediaToCharacter = async function(mediaData) {
  const columns = Object.keys(mediaData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(mediaData);

  const query = `
    INSERT INTO media_files 
    (${columns.join(', ')}) 
    VALUES (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.listCharacterMedia = async function(characterId, userId) {
  const query = `
    SELECT 
      media_id,
      user_character_id,
      cf_r2_key,
      cf_r2_url,
      tag,
      media_type,
      additional_data,
      created_at
    FROM media_files
    WHERE user_character_id = ?
    AND user_id = ?
    AND tag = 'input_image'
    ORDER BY created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [characterId, userId]);
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

exports.getMediaByTag = async function(userCharacterId, tag) {
  let query = `
    SELECT 
      media_id,
      character_id,
      user_character_id, 
      cf_r2_key,
      cf_r2_url,
      media_type,
      created_at
    FROM media_files
    WHERE user_character_id = ?
  `;

  const params = [userCharacterId];

  if (tag) {
    query += ` AND tag = ?`;
    params.push(tag);
  }

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getMediaOfMultiplesCharactersByTag = async function(userCharacterIds, tag) {
  let query = `
    SELECT 
      media_id,
      user_character_id, 
      cf_r2_key,
      cf_r2_url,
      media_type,
      created_at
    FROM media_files
    WHERE user_character_id IN (?)
  `;

  const params = [userCharacterIds];

  if (tag) {
    query += ` AND tag = ?`;
    params.push(tag);
  }

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.verifyAdminCharacter = async function(characterId) {
  const query = `
    SELECT user_character_id 
    FROM user_characters 
    WHERE user_character_id = ? 
    AND user_id IS NULL 
    AND created_by_admin_id IS NOT NULL
    AND archived_at IS NULL
  `;
  
  const [character] = await mysqlQueryRunner.runQueryInSlave(query, [characterId]);
  return !!character;
};

exports.listAdminCharacterMedia = async function(characterId) {
  const query = `
    SELECT 
      media_id,
      user_character_id,
      cf_r2_key,
      cf_r2_url,
      tag,
      media_type,
      additional_data,
      created_at
    FROM media_files
    WHERE user_character_id = ?
    AND user_id IS NULL
    AND tag = 'input_image'
    ORDER BY created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [characterId]);
};
