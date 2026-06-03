'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

const VALID_CLIENT_PLATFORMS = new Set(['android', 'ios', 'web']);

function clientPlatformFilterClause(clientPlatform) {
  const cp = clientPlatform != null ? String(clientPlatform).trim().toLowerCase() : '';
  if (!VALID_CLIENT_PLATFORMS.has(cp)) {
    return { sql: '', params: [] };
  }
  return { sql: ' AND u.client_platform = ? ', params: [cp] };
}

/**
 * Content languages from catalog with opted-in counts.
 * Counts unique actors per language (user_id or anon_device_id) whose
 * selection row was updated within [rangeStart, rangeEnd].
 *
 * @param {string} rangeStart - 'YYYY-MM-DD HH:mm:ss[.SSS]' UTC
 * @param {string} rangeEnd - 'YYYY-MM-DD HH:mm:ss[.SSS]' UTC
 * @param {string} [clientPlatform] - optional ios | android | web
 */
exports.queryContentLanguageOptedStats = async function (rangeStart, rangeEnd, clientPlatform) {
  const platform = clientPlatformFilterClause(clientPlatform);

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
            ${platform.sql}
        ),
        0
      ) AS opted_count
    FROM languages l
    WHERE l.is_content_language = 1
      AND l.archived_at IS NULL
    ORDER BY opted_count DESC, l.name ASC
  `;

  return mysqlQueryRunner.runQueryInMaster(query, [
    rangeStart,
    rangeEnd,
    ...platform.params,
  ]);
};

/**
 * Unique opted-in actors across all content languages in [rangeStart, rangeEnd]
 * (deduplicated; not summed per language).
 *
 * @param {string} rangeStart
 * @param {string} rangeEnd
 * @param {string} [clientPlatform] - optional ios | android | web
 */
exports.queryContentLanguageOverallSummary = async function (rangeStart, rangeEnd, clientPlatform) {
  const platform = clientPlatformFilterClause(clientPlatform);

  const query = `
    SELECT COUNT(DISTINCT COALESCE(u.user_id, CONCAT('anon:', u.anon_device_id))) AS overall_opted_count
    FROM user_content_language_selections u
    INNER JOIN languages l ON l.code = u.language_code
    WHERE l.is_content_language = 1
      AND l.archived_at IS NULL
      AND (u.user_id IS NOT NULL OR u.anon_device_id IS NOT NULL)
      AND u.updated_at >= ?
      AND u.updated_at <= ?
      ${platform.sql}
  `;

  const rows = await mysqlQueryRunner.runQueryInMaster(query, [
    rangeStart,
    rangeEnd,
    ...platform.params,
  ]);
  return rows[0] || { overall_opted_count: 0 };
};
