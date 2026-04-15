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
 * @param {object} filters { template_id, job_status, user_id }
 * @returns {Promise<Array>}
 */
exports.getGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20, filters = {}) {
  const offset = (page - 1) * limit;

  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);

  if (!endFormatted) {
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  /** Optional filters on resource_generations (template and/or user), merge terminal CH + MySQL in-flight. */
  if (filters.template_id || filters.user_id) {
    const idRows = await exports.listResourceGenerationIdsByCreatedRangeFilters(
      startDate,
      endDate,
      limit,
      offset,
      { template_id: filters.template_id || null, user_id: filters.user_id || null }
    );
    const orderedIds = idRows.map((r) => r.resource_generation_id).filter(Boolean);
    if (!orderedIds.length) return [];
    const mergeJobStatus =
      filters.job_status === 'in_progress' ? undefined : filters.job_status;
    let rows = await exports.mergeGenerationRowsForIds(orderedIds, {
      job_status: mergeJobStatus,
      eventStartFormatted: startFormatted,
      eventEndFormatted: endFormatted
    });
    if (filters.job_status === 'in_progress') {
      rows = rows.filter((r) => r.job_status === 'processing' || r.job_status === 'queued');
    }
    return rows;
  }

  /** Terminal-only: Success / Failed filters keep pure ClickHouse behavior. */
  if (filters.job_status === 'completed' || filters.job_status === 'failed') {
    let conditions = [
      `created_at >= '${startFormatted}'`,
      `created_at <= '${endFormatted}'`
    ];
    if (filters.job_status === 'completed') {
      conditions.push(`event_type = 'COMPLETED'`);
    } else {
      conditions.push(`event_type = 'FAILED'`);
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
  }

  /** In-progress only: MySQL queue rows in date range. */
  if (filters.job_status === 'in_progress') {
    return exports.listMysqlInProgressGenerationsByDateRange(startDate, endDate, page, limit);
  }

  /** All statuses: merge terminal events + in-progress rows by activity time (newest first). */
  return exports.getMergedTerminalAndInProgressPage(
    startFormatted,
    endFormatted,
    page,
    limit
  );
};

/**
 * ClickHouse terminal events in date range, paginated (COMPLETED + FAILED).
 * @param {string} startFormatted
 * @param {string} endFormatted
 * @param {number} page1-based
 * @param {number} limit
 */
exports.fetchChTerminalEventsPage = async function (startFormatted, endFormatted, page, limit) {
  const offset = (page - 1) * limit;
  const conditions = [
    `created_at >= '${startFormatted}'`,
    `created_at <= '${endFormatted}'`,
    `event_type IN ('COMPLETED', 'FAILED')`
  ];
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
 * In-flight generations from MySQL (submitted / in_progress) in activity date range.
 */
exports.listMysqlInProgressGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const startDb = formatDateForMySQL(startDate);
  let endDb = formatDateForMySQL(endDate);
  if (!endDb) {
    endDb = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }
  const lim = parseInt(limit, 10);
  const off = parseInt(offset, 10);
  const query = `
    SELECT 
      media_generation_id,
      job_status,
      output_media_bucket,
      output_media_asset_key,
      error_message,
      media_type,
      COALESCE(submitted_at, created_at) AS activity_at
    FROM media_generations
    WHERE job_status IN ('submitted', 'in_progress')
      AND COALESCE(submitted_at, created_at) >= ?
      AND COALESCE(submitted_at, created_at) <= ?
    ORDER BY COALESCE(submitted_at, created_at) DESC, media_generation_id ASC
    LIMIT ${Number.isFinite(lim) ? lim : 20} OFFSET ${Number.isFinite(off) ? off : 0}
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [startDb, endDb]);
  return rows.map((mg) => ({
    media_generation_id: mg.media_generation_id,
    job_status: exports.mapMysqlJobStatusToUi(mg.job_status),
    output_media_bucket: mg.output_media_bucket,
    output_media_asset_key: mg.output_media_asset_key,
    completed_at: mg.activity_at,
    error_message: mg.error_message || ''
  }));
};

function rowActivityTimeMs(row) {
  const raw = row.completed_at || row.activity_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Merge first (offset+limit) terminal + in-progress rows from each source, sort DESC, return one page.
 */
exports.getMergedTerminalAndInProgressPage = async function (startFormatted, endFormatted, page, limit) {
  const offset = (page - 1) * limit;
  const fetchCount = offset + limit;
  /** Need up to fetchCount from each source so merged slice is correct; cap for safety on admin-only API. */
  const safeFetch = Math.min(Math.max(fetchCount, limit), 5000);

  const [terminalRows, inProgressMysql] = await Promise.all([
    exports.fetchChTerminalEventsPage(startFormatted, endFormatted, 1, safeFetch),
    (async () => {
      const startDb = startFormatted;
      const endDb = endFormatted;
      const q = `
        SELECT 
          media_generation_id,
          job_status,
          output_media_bucket,
          output_media_asset_key,
          error_message,
          media_type,
          COALESCE(submitted_at, created_at) AS activity_at
        FROM media_generations
        WHERE job_status IN ('submitted', 'in_progress')
          AND COALESCE(submitted_at, created_at) >= ?
          AND COALESCE(submitted_at, created_at) <= ?
        ORDER BY COALESCE(submitted_at, created_at) DESC, media_generation_id ASC
        LIMIT ${safeFetch} OFFSET 0
      `;
      const rows = await mysqlQueryRunner.runQueryInSlave(q, [startDb, endDb]);
      return rows.map((mg) => ({
        media_generation_id: mg.media_generation_id,
        job_status: exports.mapMysqlJobStatusToUi(mg.job_status),
        output_media_bucket: mg.output_media_bucket,
        output_media_asset_key: mg.output_media_asset_key,
        completed_at: mg.activity_at,
        error_message: mg.error_message || ''
      }));
    })()
  ]);

  const merged = [...terminalRows, ...inProgressMysql].sort(
    (a, b) => rowActivityTimeMs(b) - rowActivityTimeMs(a)
  );
  return merged.slice(offset, offset + limit);
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
    SELECT template_id, template_name, template_type
    FROM templates
    WHERE template_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

function chStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * resource_generation rows in created_at range, optionally filtered by template_id and/or user_id.
 */
exports.listResourceGenerationIdsByCreatedRangeFilters = async function (
  startDate,
  endDate,
  limit,
  offset,
  filters = {}
) {
  const templateId = filters.template_id || null;
  const userId = filters.user_id || null;
  if (!templateId && !userId) return [];

  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);
  if (!endFormatted) {
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  const conditions = [
    `created_at >= '${startFormatted}'`,
    `created_at <= '${endFormatted}'`
  ];
  if (templateId) conditions.push(`template_id = ${chStringLiteral(templateId)}`);
  if (userId) conditions.push(`user_id = ${chStringLiteral(userId)}`);

  const lim = parseInt(limit, 10);
  const off = parseInt(offset, 10);
  const query = `
    SELECT resource_generation_id
    FROM resource_generations
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, resource_generation_id ASC
    LIMIT ${Number.isFinite(lim) ? lim : 20} OFFSET ${Number.isFinite(off) ? off : 0}
  `;
  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

/**
 * @deprecated Prefer listResourceGenerationIdsByCreatedRangeFilters; kept for callers that only pass template.
 */
exports.listResourceGenerationIdsByTemplateCreatedRange = async function (
  templateId,
  startDate,
  endDate,
  limit,
  offset
) {
  return exports.listResourceGenerationIdsByCreatedRangeFilters(startDate, endDate, limit, offset, {
    template_id: templateId
  });
};

/**
 * Map MySQL media_generations.job_status to values the admin generations UI expects.
 */
exports.mapMysqlJobStatusToUi = function mapMysqlJobStatusToUi(status) {
  if (status == null) return status;
  const s = String(status).toLowerCase();
  if (s === 'in_progress') return 'processing';
  if (s === 'submitted' || s === 'draft') return 'queued';
  return s;
};

/**
 * Terminal COMPLETED/FAILED events from ClickHouse for a fixed set of resource_generation_ids.
 * @param {object} [filters] optional { job_status, eventStartFormatted, eventEndFormatted }
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

  if (filters.eventStartFormatted) {
    conditions.push(`created_at >= '${filters.eventStartFormatted}'`);
  }
  if (filters.eventEndFormatted) {
    conditions.push(`created_at <= '${filters.eventEndFormatted}'`);
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
        job_status: exports.mapMysqlJobStatusToUi(mg.job_status),
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

