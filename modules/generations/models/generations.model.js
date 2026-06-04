'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { slaveClickhouse } = require('../../../config/lib/clickhouse');
const AnalyticsModel = require('../../analytics/models/analytics.model');
const moment = require('moment'); // Using moment as it's typically used in this project codebase based on API's media.generations.model.js
const { buildAccessMethodsByUserFromGenerations } = require('../services/generation-access-method.service');

/**
 * Convert ISO or Date to MySQL datetime string (YYYY-MM-DD HH:mm:ss).
 * @param {Date|string|null} date
 * @returns {string|null}
 */
function formatDateForMySQL(date) {
  if (!date) return null;
  const m = moment.utc(date);
  return m.isValid() ? m.format('YYYY-MM-DD HH:mm:ss') : null;
}

/**
 * Fetch generations with optional date filtering and pagination.
 * @param {Date|string|null} startDate
 * @param {Date|string|null} endDate
 * @param {number} page
 * @param {number} limit
 * @param {object} filters { template_id, job_status, user_id, allTime }
 * @returns {Promise<Array>}
 */
exports.getGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20, filters = {}) {
  const offset = (page - 1) * limit;
  const allTime = !!filters.allTime;

  const startFormatted = allTime ? null : formatDateForMySQL(startDate);
  let endFormatted = allTime ? null : formatDateForMySQL(endDate);
  if (!allTime && !endFormatted) {
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  /** Optional filters on resource_generations (template and/or user), merge terminal CH + MySQL in-flight. */
  if (filters.template_id || filters.user_id) {
    const idRows = await exports.listResourceGenerationIdsByCreatedRangeFilters(
      startDate,
      endDate,
      limit,
      offset,
      {
        template_id: filters.template_id || null,
        user_id: filters.user_id || null,
        allTime
      }
    );
    const orderedIds = idRows.map((r) => r.resource_generation_id).filter(Boolean);
    if (!orderedIds.length) return [];
    const mergeJobStatus =
      filters.job_status === 'in_progress' ? undefined : filters.job_status;
    let rows = await exports.mergeGenerationRowsForIds(orderedIds, {
      job_status: mergeJobStatus,
      eventStartFormatted: allTime ? undefined : startFormatted,
      eventEndFormatted: allTime ? undefined : endFormatted
    });
    if (filters.job_status === 'in_progress') {
      rows = rows.filter((r) => r.job_status === 'processing' || r.job_status === 'queued');
    }
    return rows;
  }

  /** Terminal-only: Success / Failed filters keep pure ClickHouse behavior. */
  if (filters.job_status === 'completed' || filters.job_status === 'failed') {
    const conditions = [];
    if (!allTime) {
      conditions.push(`created_at >= '${startFormatted}'`);
      conditions.push(`created_at <= '${endFormatted}'`);
    }
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
    return exports.listMysqlInProgressGenerationsByDateRange(startDate, endDate, page, limit, { allTime });
  }

  /** All statuses: merge terminal events + in-progress rows by activity time (newest first). */
  return exports.getMergedTerminalAndInProgressPage(
    startFormatted,
    endFormatted,
    page,
    limit,
    { allTime }
  );
};

/**
 * ClickHouse terminal events in date range, paginated (COMPLETED + FAILED).
 * @param {string} startFormatted
 * @param {string} endFormatted
 * @param {number} page1-based
 * @param {number} limit
 */
exports.fetchChTerminalEventsPage = async function (startFormatted, endFormatted, page, limit, options = {}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  if (!options.allTime) {
    conditions.push(`created_at >= '${startFormatted}'`);
    conditions.push(`created_at <= '${endFormatted}'`);
  }
  conditions.push(`event_type IN ('COMPLETED', 'FAILED')`);
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
exports.listMysqlInProgressGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20, options = {}) {
  const offset = (page - 1) * limit;
  const allTime = !!options.allTime;
  const startDb = allTime ? null : formatDateForMySQL(startDate);
  let endDb = allTime ? null : formatDateForMySQL(endDate);
  if (!allTime && !endDb) {
    endDb = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }
  const lim = parseInt(limit, 10);
  const off = parseInt(offset, 10);
  const dateClause = allTime
    ? ''
    : 'AND COALESCE(submitted_at, created_at) >= ? AND COALESCE(submitted_at, created_at) <= ?';
  const params = allTime ? [] : [startDb, endDb];
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
      ${dateClause}
    ORDER BY COALESCE(submitted_at, created_at) DESC, media_generation_id ASC
    LIMIT ${Number.isFinite(lim) ? lim : 20} OFFSET ${Number.isFinite(off) ? off : 0}
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, params);
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
exports.getMergedTerminalAndInProgressPage = async function (startFormatted, endFormatted, page, limit, options = {}) {
  const offset = (page - 1) * limit;
  const fetchCount = offset + limit;
  /** Need up to fetchCount from each source so merged slice is correct; cap for safety on admin-only API. */
  const safeFetch = Math.min(Math.max(fetchCount, limit), 5000);
  const allTime = !!options.allTime;

  const [terminalRows, inProgressMysql] = await Promise.all([
    exports.fetchChTerminalEventsPage(startFormatted, endFormatted, 1, safeFetch, { allTime }),
    (async () => {
      const dateClause = allTime
        ? ''
        : 'AND COALESCE(submitted_at, created_at) >= ? AND COALESCE(submitted_at, created_at) <= ?';
      const params = allTime ? [] : [startFormatted, endFormatted];
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
          ${dateClause}
        ORDER BY COALESCE(submitted_at, created_at) DESC, media_generation_id ASC
        LIMIT ${safeFetch} OFFSET 0
      `;
      const rows = await mysqlQueryRunner.runQueryInSlave(q, params);
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
      created_at,
      entitlement_id
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
    SELECT template_id, template_name, template_type, credits
    FROM templates
    WHERE template_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

/**
 * Bulk-fetch entitlements for generation access-method labeling.
 * @param {Array<number|string>} entitlementIds
 * @returns {Promise<Array<{ entitlement_id, tier_plan_type, order_id, template_id, created_at }>>}
 */
exports.getEntitlementsByIds = async function (entitlementIds) {
  if (!entitlementIds || entitlementIds.length === 0) return [];
  const ids = [...new Set(entitlementIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const query = `
    SELECT entitlement_id, tier_plan_type, order_id, template_id, created_at
    FROM entitlements
    WHERE entitlement_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * Active entitlements for users relevant to a template (pool + template-scoped à la carte).
 */
exports.getUserEntitlementsForTemplate = async function (userIds, templateId) {
  if (!userIds?.length || !templateId) return [];
  const tid = String(templateId).trim();
  const uids = [...new Set(userIds.map((u) => String(u).trim()).filter(Boolean))];
  if (!uids.length) return [];
  const query = `
    SELECT entitlement_id, user_id, tier_plan_type, template_id, order_id, created_at,
           template_slots_remaining, max_creations_per_template
    FROM entitlements
    WHERE user_id IN (?)
      AND status IN ('active', 'exhausted', 'expired')
      AND (template_id IS NULL OR template_id = ?)
    ORDER BY created_at ASC
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [uids, tid]);
};

/**
 * Per-generation rows for access-method resolution (MySQL + claimed_templates join).
 */
exports.getTemplateGenerationAccessRows = async function (templateId, userIds, startDb, endDb, allTime) {
  if (!userIds?.length) return [];
  const tid = String(templateId).trim();
  const uids = [...new Set(userIds.map((u) => String(u).trim()).filter(Boolean))];
  if (!uids.length) return [];

  const dateClause = allTime
    ? ''
    : 'AND COALESCE(mg.submitted_at, mg.created_at) >= ? AND COALESCE(mg.submitted_at, mg.created_at) <= ?';
  const params = allTime ? [tid, uids] : [tid, uids, startDb, endDb];

  const query = `
    SELECT
      mg.media_generation_id,
      mg.user_id,
      mg.entitlement_id AS mg_entitlement_id,
      mg.claimed_template_id,
      ct.entitlement_id AS claim_entitlement_id,
      COALESCE(mg.submitted_at, mg.created_at) AS activity_at
    FROM media_generations mg
    LEFT JOIN claimed_templates ct ON ct.claimed_template_id = mg.claimed_template_id
    WHERE mg.template_id = ?
      AND mg.user_id IN (?)
      AND mg.job_status IN ('submitted', 'in_progress', 'completed', 'failed')
      AND mg.deleted_at IS NULL
      ${dateClause}
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

/**
 * Per-generation rows for one user on a template (timeline), oldest first.
 */
exports.getTemplateUserGenerationTimelineRows = async function (templateId, userId, startDb, endDb, allTime) {
  const tid = templateId != null ? String(templateId).trim() : '';
  const uid = userId != null ? String(userId).trim() : '';
  if (!tid || !uid) return [];

  const dateClause = allTime
    ? ''
    : 'AND COALESCE(mg.submitted_at, mg.created_at) >= ? AND COALESCE(mg.submitted_at, mg.created_at) <= ?';
  const params = allTime ? [tid, uid] : [tid, uid, startDb, endDb];

  const query = `
    SELECT
      mg.media_generation_id,
      mg.user_id,
      mg.entitlement_id AS mg_entitlement_id,
      mg.claimed_template_id,
      ct.entitlement_id AS claim_entitlement_id,
      COALESCE(mg.submitted_at, mg.created_at) AS activity_at,
      mg.job_status
    FROM media_generations mg
    LEFT JOIN claimed_templates ct ON ct.claimed_template_id = mg.claimed_template_id
    WHERE mg.template_id = ?
      AND mg.user_id = ?
      AND mg.job_status IN ('submitted', 'in_progress', 'completed', 'failed')
      AND mg.deleted_at IS NULL
      ${dateClause}
    ORDER BY activity_at ASC
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, params);
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

  const allTime = !!filters.allTime;
  const startFormatted = allTime ? null : formatDateForMySQL(startDate);
  let endFormatted = allTime ? null : formatDateForMySQL(endDate);
  if (!allTime && !endFormatted) {
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  const conditions = [];
  if (!allTime) {
    conditions.push(`created_at >= '${startFormatted}'`);
    conditions.push(`created_at <= '${endFormatted}'`);
  }
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
 * entitlement_id per media_generation_id (MySQL source of truth for admin cards).
 */
exports.getMediaGenerationEntitlementsByMediaIds = async function (mediaGenerationIds) {
  if (!mediaGenerationIds || mediaGenerationIds.length === 0) return [];
  const query = `
    SELECT media_generation_id, entitlement_id
    FROM media_generations
    WHERE media_generation_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [mediaGenerationIds]);
};

/**
 * media_generation_ids with wallet credit reserve or deduction (subscription via credits).
 * Queued/in-flight gens often have only `reserve` until completion.
 * @returns {Promise<Set<string>>}
 */
exports.getMediaGenerationIdsWithCreditSubscriptionUsage = async function (mediaGenerationIds) {
  const ids = [...new Set((mediaGenerationIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return new Set();
  const query = `
    SELECT DISTINCT reference_id AS media_generation_id
    FROM credits_transactions
    WHERE reference_id IN (?)
      AND transaction_type IN ('deduction', 'reserve')
      AND status = 'completed'
      AND amount > 0
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [ids]);
  return new Set((rows || []).map((r) => String(r.media_generation_id).trim()).filter(Boolean));
};

/** @deprecated Use getMediaGenerationIdsWithCreditSubscriptionUsage */
exports.getMediaGenerationIdsWithCreditDeduction = exports.getMediaGenerationIdsWithCreditSubscriptionUsage;

/**
 * Template claims for access-method resolution (subscription slot, no wallet credits).
 */
exports.getClaimedTemplatesByUsersAndTemplate = async function (userIds, templateId) {
  if (!userIds?.length || !templateId) return [];
  const tid = String(templateId).trim();
  const uids = [...new Set(userIds.map((u) => String(u).trim()).filter(Boolean))];
  if (!uids.length) return [];
  const query = `
    SELECT user_id, claimed_template_id, entitlement_id, template_id, claimed_at, status
    FROM claimed_templates
    WHERE user_id IN (?)
      AND template_id = ?
      AND status IN ('active', 'exhausted')
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [uids, tid]);
};

/**
 * ClickHouse + claims + credit usage for template analytics access labels.
 */
exports.fetchTemplateAnalyticsAccessContext = async function (templateId, accessGenerationRows) {
  const rows = Array.isArray(accessGenerationRows) ? accessGenerationRows : [];
  const mediaIds = [...new Set(rows.map((r) => r.media_generation_id).filter(Boolean))];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

  const [creditUsageIds, chRows, claimRows, userEntitlementRows] = await Promise.all([
    exports.getMediaGenerationIdsWithCreditSubscriptionUsage(mediaIds),
    mediaIds.length ? exports.getResourceGenerationsByIds(mediaIds) : [],
    userIds.length ? exports.getClaimedTemplatesByUsersAndTemplate(userIds, templateId) : [],
    userIds.length ? exports.getUserEntitlementsForTemplate(userIds, templateId) : []
  ]);

  const chEntitlementByMediaId = new Map();
  for (const r of chRows || []) {
    const id = r.resource_generation_id != null ? String(r.resource_generation_id).trim() : '';
    const eid = r.entitlement_id != null ? Number(r.entitlement_id) : null;
    if (id && Number.isFinite(eid) && eid > 0) {
      chEntitlementByMediaId.set(id, eid);
    }
  }

  const claimsByUserId = {};
  for (const c of claimRows || []) {
    const uid = c.user_id != null ? String(c.user_id).trim() : '';
    if (!uid) continue;
    if (!claimsByUserId[uid]) claimsByUserId[uid] = [];
    claimsByUserId[uid].push(c);
  }

  const entitlementsByUserId = {};
  const entitlementIdSet = new Set();
  for (const e of userEntitlementRows || []) {
    const uid = e.user_id != null ? String(e.user_id).trim() : '';
    if (!uid) continue;
    if (!entitlementsByUserId[uid]) entitlementsByUserId[uid] = [];
    entitlementsByUserId[uid].push(e);
    if (e.entitlement_id != null) entitlementIdSet.add(Number(e.entitlement_id));
  }
  for (const eid of chEntitlementByMediaId.values()) entitlementIdSet.add(eid);
  for (const c of claimRows || []) {
    if (c.entitlement_id != null) entitlementIdSet.add(Number(c.entitlement_id));
  }
  for (const row of rows) {
    for (const key of ['mg_entitlement_id', 'claim_entitlement_id']) {
      const n = Number(row[key]);
      if (Number.isFinite(n) && n > 0) entitlementIdSet.add(n);
    }
  }

  const entitlementRows = entitlementIdSet.size
    ? await exports.getEntitlementsByIds([...entitlementIdSet])
    : [];
  const entitlementMap = {};
  for (const e of entitlementRows || []) {
    if (e.entitlement_id != null) entitlementMap[e.entitlement_id] = e;
  }

  return {
    creditUsageIds,
    chEntitlementByMediaId,
    claimsByUserId,
    entitlementsByUserId,
    entitlementMap
  };
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

/**
 * Per-user generation counts for a template in a date range (CH terminal + MySQL in-flight).
 * @returns {Promise<{ rows: Array, total: number }>}
 */
exports.getTemplateGenerationUserSummary = async function (
  templateId,
  startDate,
  endDate,
  page = 1,
  limit = 20,
  options = {}
) {
  const tid = templateId != null ? String(templateId).trim() : '';
  if (!tid) return { rows: [], total: 0, template_type: null };

  const allTime = !!options.allTime;
  let startFormatted = allTime ? null : options.utcDateTimeStart || formatDateForMySQL(startDate);
  let endFormatted = allTime ? null : options.utcDateTimeEnd || formatDateForMySQL(endDate);
  const rangeStartUtc = allTime ? null : (options.rangeStartUtc || startFormatted);
  const rangeEndUtc = allTime ? null : (options.rangeEndUtc || endFormatted);
  if (!allTime && !endFormatted) {
    endFormatted = moment.utc().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }
  const startDb = startFormatted;
  const endDb = endFormatted;

  let chStats = [];
  if (!allTime && rangeStartUtc && rangeEndUtc) {
    chStats = await AnalyticsModel.getTemplateQueueUserSummaryRaw(tid, rangeStartUtc, rangeEndUtc);
  } else if (!allTime) {
    const dateClauseCh = `AND created_at >= '${startFormatted}' AND created_at <= '${endFormatted}'`;
    const chStatsQuery = `
      SELECT
        user_id,
        count() AS generation_count,
        argMax(resource_generation_id, created_at) AS latest_generation_id,
        max(created_at) AS last_created_at
      FROM resource_generations
      WHERE template_id = ${chStringLiteral(tid)}
        AND user_id != ''
        ${dateClauseCh}
      GROUP BY user_id
    `;
    const chStatsRes = await slaveClickhouse.querying(chStatsQuery, { dataObjects: true });
    chStats = chStatsRes.data || [];
  } else {
    const chStatsQuery = `
      SELECT
        user_id,
        count() AS generation_count,
        argMax(resource_generation_id, created_at) AS latest_generation_id,
        max(created_at) AS last_created_at
      FROM resource_generations
      WHERE template_id = ${chStringLiteral(tid)}
        AND user_id != ''
      GROUP BY user_id
    `;
    const chStatsRes = await slaveClickhouse.querying(chStatsQuery, { dataObjects: true });
    chStats = chStatsRes.data || [];
  }

  let mysqlStats = [];
  const dateClauseMysql = allTime
    ? ''
    : 'AND COALESCE(submitted_at, created_at) >= ? AND COALESCE(submitted_at, created_at) <= ?';
  const mysqlParams = allTime ? [tid] : [tid, startDb, endDb];

  const mysqlStatsQuery = `
    SELECT
      user_id,
      COUNT(*) AS generation_count,
      SUBSTRING_INDEX(GROUP_CONCAT(media_generation_id ORDER BY COALESCE(submitted_at, created_at) DESC), ',', 1) AS latest_generation_id,
      MAX(COALESCE(submitted_at, created_at)) AS last_created_at
    FROM media_generations
    WHERE template_id = ?
      AND job_status IN ('submitted', 'in_progress')
      ${dateClauseMysql}
    GROUP BY user_id
  `;
  mysqlStats = await mysqlQueryRunner.runQueryInSlave(mysqlStatsQuery, mysqlParams);

  const byUser = new Map();

  const upsertStat = (row, source) => {
    const uid = row.user_id != null ? String(row.user_id).trim() : '';
    if (!uid) return;
    const cnt = Number(row.generation_count) || 0;
    const latestId = row.latest_generation_id != null ? String(row.latest_generation_id).trim() : '';
    const lastAt = row.last_created_at;

    let entry = byUser.get(uid);
    if (!entry) {
      entry = {
        user_id: uid,
        generation_count: 0,
        latest_generation_id: '',
        last_created_at: null
      };
      byUser.set(uid, entry);
    }
    entry.generation_count += cnt;
    if (latestId) {
      const existingMs = entry.last_created_at ? new Date(entry.last_created_at).getTime() : 0;
      const newMs = lastAt ? new Date(lastAt).getTime() : 0;
      if (!entry.latest_generation_id || newMs >= existingMs) {
        entry.latest_generation_id = latestId;
        entry.last_created_at = lastAt;
      }
    }
  };

  chStats.forEach((r) => upsertStat(r, 'ch'));
  /** In-flight rows may exist only in MySQL until hub queue event is visible; supplement missing users only. */
  mysqlStats.forEach((r) => {
    const uid = r.user_id != null ? String(r.user_id).trim() : '';
    if (uid && !byUser.has(uid)) upsertStat(r, 'mysql');
  });

  let merged = [...byUser.values()].sort((a, b) => {
    if (b.generation_count !== a.generation_count) {
      return b.generation_count - a.generation_count;
    }
    const ta = a.last_created_at ? new Date(a.last_created_at).getTime() : 0;
    const tb = b.last_created_at ? new Date(b.last_created_at).getTime() : 0;
    return tb - ta;
  });

  const total = merged.length;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  merged = merged.slice(offset, offset + safeLimit);

  const templateRows = await exports.getTemplatesByIds([tid]);
  const templateMeta = templateRows[0] || {};

  const pageUserIds = merged.map((r) => r.user_id);
  const accessGenerationRows = await exports.getTemplateGenerationAccessRows(
    tid,
    pageUserIds,
    startDb,
    endDb,
    allTime
  );

  const analyticsContext = await exports.fetchTemplateAnalyticsAccessContext(tid, accessGenerationRows);

  const accessMethodsByUser = buildAccessMethodsByUserFromGenerations(
    accessGenerationRows,
    analyticsContext.entitlementsByUserId,
    { templateType: templateMeta.template_type, credits: templateMeta.credits },
    analyticsContext
  );

  const userIds = pageUserIds;
  const users = userIds.length ? await exports.getUsersByIds(userIds) : [];
  const userMap = {};
  users.forEach((u) => {
    userMap[u.user_id] = u;
  });

  const rows = merged.map((row) => {
    const access_methods = accessMethodsByUser.get(row.user_id) || [];
    const u = userMap[row.user_id];
    return {
      user_id: row.user_id,
      generation_count: row.generation_count,
      latest_generation_id: row.latest_generation_id || null,
      last_created_at: row.last_created_at,
      access_methods,
      user_details: u
        ? {
            display_name: u.display_name,
            email: u.email,
            mobile: u.mobile
          }
        : null
    };
  });

  return {
    rows,
    total,
    template_type: templateMeta.template_type || null
  };
};

