'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List all languages (non-archived)
 */
exports.listLanguages = async function (pagination) {
  const query = `
    SELECT 
      language_id,
      code,
      name,
      native_name,
      is_app_language,
      is_content_language,
      direction,
      status,
      background_style,
      created_at,
      updated_at
    FROM languages
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query,
    [pagination.limit, pagination.offset]
  );
};

/**
 * Get language by ID
 */
exports.getLanguageById = async function (languageId) {
  const query = `
    SELECT 
      language_id,
      code,
      name,
      native_name,
      is_app_language,
      is_content_language,
      direction,
      status,
      background_style,
      created_at,
      updated_at
    FROM languages
    WHERE language_id = ? AND archived_at IS NULL
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, [languageId]);
  return results.length ? results[0] : null;
};

/**
 * Get language by code
 */
exports.getLanguageByCode = async function (code) {
  const query = `
    SELECT 
      language_id,
      code,
      name,
      native_name,
      is_app_language,
      is_content_language,
      direction,
      status,
      background_style,
      created_at,
      updated_at
    FROM languages
    WHERE code = ? AND archived_at IS NULL
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, [code]);
  return results.length ? results[0] : null;
};

/**
 * Create a new language
 */
exports.createLanguage = async function (languageData) {
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(languageData).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      fields.push(key);
      values.push(value);
      placeholders.push('?');
    }
  });

  const insertQuery = `
    INSERT INTO languages (
      ${fields.join(', ')}
    ) VALUES (${placeholders.join(', ')})
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

/**
 * Update a language
 */
exports.updateLanguage = async function (languageId, languageData) {
  const setClauses = [];
  const values = [];

  Object.entries(languageData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (setClauses.length === 0) return null;

  values.push(languageId);

  const updateQuery = `
    UPDATE languages 
    SET ${setClauses.join(', ')}
    WHERE language_id = ? AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(updateQuery, values);
  return result.affectedRows > 0 ? result : null;
};

/**
 * Archive a language (soft delete)
 */
exports.archiveLanguage = async function (languageId) {
  const query = `
    UPDATE languages 
    SET archived_at = NOW(3), status = 'archived'
    WHERE language_id = ? AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [languageId]);
  return result.affectedRows > 0 ? result : null;
};
