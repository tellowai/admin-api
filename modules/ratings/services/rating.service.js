'use strict';

const moment = require('moment');
const RatingModel = require('../models/rating.model');
const GenerationsModel = require('../../generations/models/generations.model');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const TimezoneService = require('../../analytics/services/timezone.service');

const DEFAULT_LIMIT = 20;

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

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const users = userIds.length ? await GenerationsModel.getUsersByIds(userIds) : [];
  const userMap = {};
  users.forEach((u) => {
    userMap[u.user_id] = u;
  });

  const enriched = rows.map((row) => {
    const user = row.user_id ? userMap[row.user_id] : null;
    return {
      rating_id: row.rating_id,
      user_id: row.user_id,
      app_version: row.app_version,
      rating: Number(row.rating),
      reason: row.reason,
      platform: row.platform,
      created_at: row.created_at,
      user_details: user
        ? {
            display_name: user.display_name,
            email: user.email,
            mobile: user.mobile
          }
        : null
    };
  });

  return PaginationCtrl.formatPaginationResponse(enriched, total, pagination);
};
