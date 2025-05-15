'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.getUserGenerations = async function(userId, page, limit, type) {
  const offset = (page - 1) * limit;
  
  let tagFilter = "tag IN ('output_image', 'output_video')";
  if (type === 'image') {
    tagFilter = "tag = 'output_image'";
  } else if (type === 'video') {
    tagFilter = "tag = 'output_video'";
  }

  const query = `
    SELECT 
      media_id,
      user_character_id,
      cf_r2_key,
      additional_data,
      tag,
      created_at
    FROM media_files
    WHERE user_id = ?
    AND ${tagFilter}
    AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userId, limit, offset]);
};

exports.getCharacterDetails = async function(userCharacterIds) {
  if (!userCharacterIds.length) return [];
  
  const query = `
    SELECT 
      user_character_id,
      character_name,
      thumb_cf_r2_key
    FROM user_characters
    WHERE user_character_id IN (?)
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [userCharacterIds]);
}; 