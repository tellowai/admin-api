'use strict';

const moment = require('moment-timezone');
const TimezoneService = require('../../analytics/services/timezone.service');
const CustomersLanguagesModel = require('../models/customers.languages.model');

function toCalendarYmd(value) {
  if (value instanceof Date) {
    return moment(value).format('YYYY-MM-DD');
  }
  const s = String(value).trim();
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

function resolveUtcRange(start_date, end_date, tz) {
  const timezone = tz || TimezoneService.getDefaultTimezone();

  let startMoment;
  let endMoment;

  if (!start_date || !end_date) {
    startMoment = moment.utc().subtract(6, 'days').startOf('day');
    endMoment = moment.utc().endOf('day');
  } else {
    const startYmd = toCalendarYmd(start_date);
    const endYmd = toCalendarYmd(end_date);
    startMoment = moment.tz(`${startYmd} 00:00:00.000`, timezone).utc();
    endMoment = moment.tz(`${endYmd} 23:59:59.999`, timezone).utc();
  }

  return {
    rangeStart: startMoment.format('YYYY-MM-DD HH:mm:ss.SSS'),
    rangeEnd: endMoment.format('YYYY-MM-DD HH:mm:ss.SSS'),
  };
}

exports.getContentLanguageOptedStats = async function ({ start_date, end_date, tz }) {
  const { rangeStart, rangeEnd } = resolveUtcRange(start_date, end_date, tz);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[customers.languages] opted-stats range', { rangeStart, rangeEnd, start_date, end_date, tz });
  }
  const [rows, summaryRow] = await Promise.all([
    CustomersLanguagesModel.queryContentLanguageOptedStats(rangeStart, rangeEnd),
    CustomersLanguagesModel.queryContentLanguageOverallSummary(rangeStart, rangeEnd),
  ]);

  return {
    languages: rows.map((row) => ({
      code: row.code,
      name: row.name,
      native_name: row.native_name,
      status: row.status,
      is_content_language: row.is_content_language,
      opted_count: Number(row.opted_count) || 0,
    })),
    summary: {
      overall_opted_count: Number(summaryRow.overall_opted_count) || 0,
    },
  };
};
