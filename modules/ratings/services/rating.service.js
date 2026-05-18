'use strict';

const moment = require('moment');
const RatingModel = require('../models/rating.model');
const GenerationsModel = require('../../generations/models/generations.model');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const TimezoneService = require('../../analytics/services/timezone.service');

const DEFAULT_LIMIT = 20;

function normalizePlatform(platform) {
  const key = String(platform || '').trim().toLowerCase();
  if (!key) return null;
  if (key === 'www' || key === 'browser') return 'web';
  return key;
}

/**
 * Resolve date range: default last 7 days (including today) when omitted.
 */
function resolveDateRange(start_date, end_date, tz) {
  const timezone = tz || TimezoneService.getDefaultTimezone();

  if (!start_date || !end_date) {
    return {
      startDate: moment().subtract(6, 'days').startOf('day').toDate(),
      endDate: moment().endOf('day').toDate()
    };
  }

  const utcFilters = TimezoneService.convertToUTC(start_date, end_date, null, null, timezone);
  return {
    startDate: moment.utc(`${utcFilters.start_date} ${utcFilters.start_time}`).toDate(),
    endDate: moment.utc(`${utcFilters.end_date} ${utcFilters.end_time}`).toDate()
  };
}

/**
 * Infer template + generation from media_generations (no app_ratings schema change).
 * Uses the user's latest generation at or before the rating timestamp.
 */
async function resolveGenerationContext(rows) {
  const needing = rows.filter((r) => r.user_id);
  if (!needing.length) return;

  await Promise.all(
    needing.map(async (row) => {
      const gen = await RatingModel.getLatestGenerationBeforeTime(row.user_id, row.created_at);
      if (!gen) return;
      row.media_generation_id = gen.media_generation_id;
      row.template_id = gen.template_id;
      row.generation_created_at = gen.completed_at || gen.created_at;
    })
  );
}

/**
 * @param {Object} query - req.query
 */
exports.listRatings = async function (query) {
  const { start_date, end_date, tz, platform } = query;
  const pagination = PaginationCtrl.getPaginationParams({
    ...query,
    limit: query.limit || DEFAULT_LIMIT
  });

  const { startDate, endDate } = resolveDateRange(start_date, end_date, tz);

  if (moment(startDate).isAfter(moment(endDate))) {
    const err = new Error('Start date cannot be after end date.');
    err.statusCode = 400;
    throw err;
  }

  const platformFilter = platform ? String(platform).trim().toLowerCase() : null;

  const { rows, total } = await RatingModel.listRatingsByDateRange({
    startDate,
    endDate,
    limit: pagination.limit,
    offset: pagination.offset,
    platform: platformFilter || undefined
  });

  await resolveGenerationContext(rows);

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const templateIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))];

  const [users, templates] = await Promise.all([
    userIds.length ? GenerationsModel.getUsersByIds(userIds) : [],
    templateIds.length ? GenerationsModel.getTemplatesByIds(templateIds) : []
  ]);

  const userMap = {};
  users.forEach((u) => {
    userMap[u.user_id] = u;
  });

  const templateMap = {};
  templates.forEach((t) => {
    templateMap[t.template_id] = t;
  });

  const enriched = rows.map((row) => {
    const user = row.user_id ? userMap[row.user_id] : null;
    const template = row.template_id ? templateMap[row.template_id] : null;
    return {
      rating_id: row.rating_id,
      user_id: row.user_id,
      app_version: row.app_version,
      rating: Number(row.rating),
      reason: row.reason,
      platform: normalizePlatform(row.platform),
      template_id: row.template_id || null,
      media_generation_id: row.media_generation_id || null,
      generation_created_at: row.generation_created_at || null,
      created_at: row.created_at,
      user_details: user
        ? {
            display_name: user.display_name,
            email: user.email,
            mobile: user.mobile
          }
        : null,
      template_details: template
        ? {
            template_id: template.template_id,
            template_name: template.template_name,
            template_type: template.template_type
          }
        : null
    };
  });

  return PaginationCtrl.formatPaginationResponse(enriched, total, pagination);
};
