'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { slaveClickhouse } = require('../../../config/lib/clickhouse');
const moment = require('moment'); // Using moment as it's typically used in this project codebase based on API's media.generations.model.js

/**
 * Convert ISO or Date to MySQL datetime string (YYYY-MM-DD HH:mm:ss).
 * @param {Date|string|null} date
 * @returns {string|null}
 */
function formatDateForMySQL(date) {
  if (!date) return null;
  const m = moment(date);
  return m.isValid() ? m.format('YYYY-MM-DD HH:mm:ss') : null;
}

/**
 * Fetch generations with date filtering and pagination
 * @param {Date|string} startDate 
 * @param {Date|string} endDate 
 * @param {number} page 
 * @param {number} limit 
 * @param {object} filters { template_id, job_status }
 * @returns {Promise<Array>}
 */
exports.getGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20, filters = {}) {
  const offset = (page - 1) * limit;

  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);

  if(!endFormatted) {
    // defaults to end of today if not valid
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  let conditions = [
    `created_at >= '${startFormatted}'`,
    `created_at <= '${endFormatted}'`
  ];

  if (filters.job_status) {
    if (filters.job_status === 'completed') {
      conditions.push(`event_type = 'COMPLETED'`);
    } else if (filters.job_status === 'failed') {
      conditions.push(`event_type = 'FAILED'`);
    } else {
      conditions.push(`event_type IN ('COMPLETED', 'FAILED')`);
    }
  } else {
    conditions.push(`event_type IN ('COMPLETED', 'FAILED')`);
  }

  if (filters.template_id) {
    // We need to filter by template_id which is in resource_generations table.
    // ClickHouse JOINs can be heavy, but here we can use a subquery for IDs if it's small or IN clause.
    // Given the zero-join policy (though ClickHouse is different), let's keep it efficient.
    conditions.push(`resource_generation_id IN (SELECT resource_generation_id FROM resource_generations WHERE template_id = '${filters.template_id}')`);
  }

  const query = `
    SELECT 
      resource_generation_id AS media_generation_id,
      if(event_type = 'COMPLETED', 'completed', 'failed') AS job_status,
      JSONExtractString(additional_data, 'output', 'asset_bucket') AS output_media_bucket,
      JSONExtractString(additional_data, 'output', 'asset_key') AS output_media_asset_key,
      created_at AS completed_at,
      if(event_type = 'FAILED', JSONExtractString(additional_data, 'error', 'message'), '') AS error_message
    FROM resource_generation_events
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, resource_generation_id ASC
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
  `;

  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

/**
 * Fetch total count of generations within that date range for pagination calculation
 * @param {Date|string} startDate 
 * @param {Date|string} endDate 
 * @returns {Promise<number>}
 */
exports.getGenerationsCountByDateRange = async function (startDate, endDate) {
  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);

  if(!endFormatted) {
    // defaults to end of today if not valid
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  const query = `
    SELECT COUNT(*) as total
    FROM resource_generation_events
    WHERE event_type IN ('COMPLETED', 'FAILED')
      AND created_at >= '${startFormatted}' AND created_at <= '${endFormatted}'
  `;

  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data?.[0]?.total || 0;
};

/**
 * Fetch bulk resource generations by IDs from ClickHouse
 * @param {Array<string>} generationIds
 * @returns {Promise<Array>}
 */
exports.getResourceGenerationsByIds = async function (generationIds) {
  if (!generationIds || generationIds.length === 0) return [];
  
  // Format the IDs for ClickHouse IN clause (strings wrapped in single quotes)
  const formattedIds = generationIds.map(id => `'${id}'`).join(',');
  
  const query = `
    SELECT 
      resource_generation_id,
      user_id,
      template_id,
      media_type,
      created_at
    FROM resource_generations
    WHERE resource_generation_id IN (${formattedIds})
  `;
  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

/**
 * Fetch bulk users by IDs
 * @param {Array<string>} userIds
 * @returns {Promise<Array>}
 */
exports.getUsersByIds = async function (userIds) {
  if (!userIds || userIds.length === 0) return [];
  const query = `
    SELECT user_id, display_name, email, mobile, profile_pic, profile_pic_asset_key, profile_pic_bucket
    FROM user
    WHERE user_id IN (?)
  `;
  // runQueryInSlave to offload reading if master isn't strictly needed
  return await mysqlQueryRunner.runQueryInSlave(query, [userIds]);
};

/**
 * Fetch bulk templates by IDs
 * @param {Array<string>} templateIds
 * @returns {Promise<Array>}
 */
exports.getTemplatesByIds = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) return [];
  const query = `
    SELECT template_id, template_name
    FROM templates
    WHERE template_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

function chStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Map MySQL media_generations.job_status to values the admin generations UI expects.
 */
function mapMysqlJobStatusToUi(status) {
  if (status == null) return status;
  const s = String(status).toLowerCase();
  if (s === 'in_progress') return 'processing';
  if (s === 'submitted' || s === 'draft') return 'queued';
  return s;
}

/**
 * Terminal COMPLETED/FAILED events from ClickHouse for a fixed set of resource_generation_ids.
 * @param {object} [filters] optional { template_id, job_status } same semantics as getGenerationsByDateRange
 */
exports.getTerminalEventsForMediaIds = async function (mediaGenerationIds, filters = {}) {
  if (!mediaGenerationIds || mediaGenerationIds.length === 0) return [];

  const idsSql = mediaGenerationIds.map((id) => chStringLiteral(id)).join(',');

  const conditions = [
    `resource_generation_id IN (${idsSql})`,
    `event_type IN ('COMPLETED', 'FAILED')`
  ];

  if (filters.job_status) {
    if (filters.job_status === 'completed') {
      conditions.push(`event_type = 'COMPLETED'`);
    } else if (filters.job_status === 'failed') {
      conditions.push(`event_type = 'FAILED'`);
    }
  }

  if (filters.template_id) {
    conditions.push(
      `resource_generation_id IN (SELECT resource_generation_id FROM resource_generations WHERE template_id = ${chStringLiteral(filters.template_id)})`
    );
  }

  const query = `
    SELECT 
      resource_generation_id AS media_generation_id,
      if(event_type = 'COMPLETED', 'completed', 'failed') AS job_status,
      JSONExtractString(additional_data, 'output', 'asset_bucket') AS output_media_bucket,
      JSONExtractString(additional_data, 'output', 'asset_key') AS output_media_asset_key,
      created_at AS completed_at,
      if(event_type = 'FAILED', JSONExtractString(additional_data, 'error', 'message'), '') AS error_message
    FROM resource_generation_events
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, resource_generation_id ASC
  `;

  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

exports.getMediaGenerationsByIds = async function (mediaGenerationIds) {
  if (!mediaGenerationIds || mediaGenerationIds.length === 0) return [];
  const query = `
    SELECT 
      media_generation_id,
      job_status,
      output_media_bucket,
      output_media_asset_key,
      error_message,
      media_type,
      updated_at,
      completed_at
    FROM media_generations
    WHERE media_generation_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [mediaGenerationIds]);
};

/**
 * Build one row per id (preserves order) for admin generations enrichment.
 * Prefer ClickHouse terminal event; fall back to MySQL media_generations for in-flight jobs.
 */
exports.mergeGenerationRowsForIds = async function (orderedIds, filters = {}) {
  if (!orderedIds || orderedIds.length === 0) return [];

  const chRows = await exports.getTerminalEventsForMediaIds(orderedIds, filters);
  const chById = new Map();
  for (const row of chRows) {
    if (row.media_generation_id && !chById.has(row.media_generation_id)) {
      chById.set(row.media_generation_id, row);
    }
  }

  const missingForMysql = orderedIds.filter((id) => !chById.has(id));
  let mysqlById = new Map();
  if (missingForMysql.length > 0) {
    const mysqlRows = await exports.getMediaGenerationsByIds(missingForMysql);
    mysqlById = new Map(mysqlRows.map((r) => [r.media_generation_id, r]));
  }

  const out = [];
  for (const id of orderedIds) {
    let row = chById.get(id);
    if (!row) {
      const mg = mysqlById.get(id);
      if (!mg) continue;
      row = {
        media_generation_id: mg.media_generation_id,
        job_status: mapMysqlJobStatusToUi(mg.job_status),
        output_media_bucket: mg.output_media_bucket,
        output_media_asset_key: mg.output_media_asset_key,
        completed_at: mg.completed_at || mg.updated_at,
        error_message: mg.error_message || ''
      };
    }
    out.push(row);
  }
  return out;
};

