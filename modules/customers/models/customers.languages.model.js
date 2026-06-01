'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Content languages from catalog with opted-in counts.
 * Counts unique actors per language (user_id or anon_device_id) whose
 * selection row was updated within [rangeStart, rangeEnd].
 *
 * @param {string} rangeStart - 'YYYY-MM-DD HH:mm:ss[.SSS]' UTC
 * @param {string} rangeEnd - 'YYYY-MM-DD HH:mm:ss[.SSS]' UTC
 */
exports.queryContentLanguageOptedStats = async function (rangeStart, rangeEnd) {
  const query = `
    SELECT
      l.code,
      l.name,
      l.native_name,
      l.status,
      l.is_content_language,
      COALESCE(
        (
          SELECT COUNT(DISTINCT COALESCE(u.user_id, CONCAT('anon:', u.anon_device_id)))
          FROM user_content_language_selections u
          WHERE u.language_code = l.code
            AND (u.user_id IS NOT NULL OR u.anon_device_id IS NOT NULL)
            AND u.updated_at >= ?
            AND u.updated_at <= ?
        ),
        0
      ) AS opted_count
    FROM languages l
    WHERE l.is_content_language = 1
      AND l.archived_at IS NULL
    ORDER BY opted_count DESC, l.name ASC
  `;

  return mysqlQueryRunner.runQueryInMaster(query, [rangeStart, rangeEnd]);
};
