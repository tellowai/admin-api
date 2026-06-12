'use strict';

const TimezoneService = require('../../analytics/services/timezone.service');

/**
 * Client-calendar date window for attribution ClickHouse queries.
 * Same semantics as Growth metrics / orders-funnel (`utcRangeForClientCalendar`).
 *
 * @param {object} query HTTP query with start_date, end_date, optional tz
 * @returns {{ startCal: string, endCal: string, tz: string, rangeStartUtc: string, rangeEndUtc: string }}
 */
function resolveAttributionDateWindow(query) {
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  if (!startDate || !endDate) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  const tz = TimezoneService.normalizeTimezoneAlias(query.tz || query.timezone || 'UTC');
  const startCal = TimezoneService.toCalendarYmd(startDate);
  const endCal = TimezoneService.toCalendarYmd(endDate);
  const { rangeStartUtc, rangeEndUtc } = TimezoneService.utcRangeForClientCalendar(startCal, endCal, tz);
  return { startCal, endCal, tz, rangeStartUtc, rangeEndUtc };
}

module.exports = {
  resolveAttributionDateWindow
};
