'use strict';

const moment = require('moment-timezone');
const TimezoneService = require('../../analytics/services/timezone.service');
const OrdersAnalyticsModel = require('../models/orders.analytics.model');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

function toCalendarDate(d) {
  if (!d) return '';
  if (d instanceof Date) return moment(d).format('YYYY-MM-DD');
  const s = String(d);
  return s.includes('T') ? s.split('T')[0] : s;
}

/** IANA aliases; MySQL time_zone tables often expect Asia/Kolkata. */
const MYSQL_TZ_ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata'
};

function normalizeMysqlTimezone(tz) {
  const t = tz && String(tz).trim() ? String(tz).trim() : TimezoneService.getDefaultTimezone();
  return MYSQL_TZ_ALIASES[t] || t;
}

exports.getOrdersStatusDaily = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date);
    const endCal = toCalendarDate(q.end_date);
    const productType = q.product_type != null && String(q.product_type).trim() !== '' ? String(q.product_type).trim() : '';
    const paymentGateway =
      q.payment_gateway != null && String(q.payment_gateway).trim() !== '' ? String(q.payment_gateway).trim() : '';

    const data = await OrdersAnalyticsModel.getOrdersStatusDaily({
      startCal,
      endCal,
      tz,
      productType: productType || undefined,
      paymentGateway: paymentGateway || undefined
    });

    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    console.error('getOrdersStatusDaily error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load order analytics' });
  }
};

exports.getOrdersStatusSummary = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date);
    const endCal = toCalendarDate(q.end_date);
    const productType = q.product_type != null && String(q.product_type).trim() !== '' ? String(q.product_type).trim() : '';
    const paymentGateway =
      q.payment_gateway != null && String(q.payment_gateway).trim() !== '' ? String(q.payment_gateway).trim() : '';

    const summary = await OrdersAnalyticsModel.getOrdersStatusSummary({
      startCal,
      endCal,
      tz,
      productType: productType || undefined,
      paymentGateway: paymentGateway || undefined
    });

    return res.status(HTTP_STATUS_CODES.OK).json({ data: summary });
  } catch (err) {
    console.error('getOrdersStatusSummary error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load order summary' });
  }
};
