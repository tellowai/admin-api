'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.deleteMediaFile = async function(mediaId, userId) {
  const query = `
    UPDATE media_files
    SET deleted_at = CURRENT_TIMESTAMP(3)
    WHERE media_id = ?
    AND user_id = ?
    AND deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [mediaId, userId]);
};

exports.getMediaFile = async function(mediaId, userId) {
  const query = `
    SELECT *
    FROM media_files
    WHERE media_id = ?
    AND user_id = ?
    AND deleted_at IS NULL
  `;

  const [mediaFile] = await mysqlQueryRunner.runQueryInSlave(query, [mediaId, userId]);
  return mediaFile;
};
