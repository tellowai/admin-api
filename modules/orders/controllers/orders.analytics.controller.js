'use strict';

const moment = require('moment-timezone');
const TimezoneService = require('../../analytics/services/timezone.service');
const OrdersAnalyticsModel = require('../models/orders.analytics.model');
const OrdersModel = require('../models/orders.model');
const SubscriptionsAnalyticsModel = require('../../analytics/models/subscriptions.analytics.model');
const CreditsModel = require('../../credits/models/credits.model');
const {
  SUBSCRIPTION_EVENT_TYPE_KEYS,
  normalizeSubscriptionEventTypeFilter,
  labelForSubscriptionEventTypeKey
} = require('../constants/subscription-event-types');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const { formatGuestDeviceDisplayName } = require('../utils/guestDeviceDisplay.util');
const { stitchGuestDeviceDetailsForRows } = require('../utils/guestDeviceStitch.util');

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'renewed',
  'pending',
  'trial',
  'paused',
  'upgraded',
  'active_non_recurring',
  'upgraded_non_recurring',
  'pending_otp_verification_for_upgrade'
]);

function subscriptionPeriodEndMs(row) {
  const end = row.current_period_end || row.renews_at || row.end_at;
  if (!end) return null;
  const t = new Date(end).getTime();
  return Number.isNaN(t) ? null : t;
}

function displaySubscriptionStatus(row) {
  const status = row.status != null ? String(row.status) : '';
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    const endMs = subscriptionPeriodEndMs(row);
    if (endMs != null && endMs <= Date.now()) return 'expired';
  }
  return status || 'unknown';
}

function formatPlatformLabel(clientPlatform) {
  const p = clientPlatform && String(clientPlatform).trim().toLowerCase();
  if (p === 'ios') return 'iOS';
  if (p === 'android') return 'Android';
  if (p === 'web') return 'Web';
  return 'Unknown';
}

function formatGatewayLabel(orderGateway, subscriptionProvider) {
  const raw =
    (orderGateway && String(orderGateway).trim()) ||
    (subscriptionProvider && String(subscriptionProvider).trim()) ||
    '';
  const g = raw.toLowerCase();
  const map = {
    razorpay: 'Razorpay',
    google_play: 'Google Play',
    apple_iap: 'Apple',
    apple: 'Apple',
    revenuecat: 'RevenueCat',
    stripe: 'Stripe',
    dodopayments: 'Dodo Payments'
  };
  if (map[g]) return map[g];
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatIsoDate(val) {
  if (val == null) return null;
  const t = new Date(val).getTime();
  if (Number.isNaN(t)) return String(val);
  return new Date(val).toISOString();
}

function parseSubscriptionAdditionalData(raw) {
  if (raw == null || raw === '') return null;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Admin table: Renewal vs initial vs upgrade vs one-time, from `subscriptions.additional_data`
 * and `payment_type` (renewal rows set `previous_subscription_id` in subscription.service).
 */
function classifySubscriptionEventType(row) {
  const data = parseSubscriptionAdditionalData(row.subscription_additional_data);
  if (data && typeof data === 'object') {
    const prev = data.previous_subscription_id;
    if (prev != null && String(prev).trim() !== '') {
      return SUBSCRIPTION_EVENT_TYPE_KEYS.RENEWAL;
    }
    const rc = data.renewal_count;
    if (rc != null && Number(rc) > 0) {
      return SUBSCRIPTION_EVENT_TYPE_KEYS.RENEWAL;
    }
    const notes = data.notes;
    if (notes && typeof notes === 'object' && notes.type === 'upgrade') {
      return SUBSCRIPTION_EVENT_TYPE_KEYS.UPGRADE;
    }
  }

  const pt = String(row.payment_type || '').toLowerCase();
  if (pt === 'one_time' || pt === 'onetime') {
    return SUBSCRIPTION_EVENT_TYPE_KEYS.ONE_TIME;
  }

  return SUBSCRIPTION_EVENT_TYPE_KEYS.INITIAL;
}

function planCreditsFromMap(providerPlanId, planMap) {
  if (providerPlanId == null || String(providerPlanId).trim() === '') {
    return { credits: null, bonus_credits: null };
  }
  const meta = planMap && planMap.get(String(providerPlanId).trim());
  if (!meta) {
    return { credits: null, bonus_credits: null };
  }
  return {
    credits: meta.credits != null && Number.isFinite(Number(meta.credits)) ? Number(meta.credits) : null,
    bonus_credits:
      meta.bonus_credits != null && Number.isFinite(Number(meta.bonus_credits))
        ? Number(meta.bonus_credits)
        : null
  };
}

function buildSubscriptionRowDtos(rawRows, planMap = new Map(), balanceMap = new Map(), deviceBalanceMap = new Map()) {
  return (rawRows || []).map((r) => {
    const { credits, bonus_credits } = planCreditsFromMap(r.provider_plan_id, planMap);
    const subscriptionEventTypeKey = classifySubscriptionEventType(r);
    const isGuestUnclaimed = r.user_id == null && r.device_id != null && String(r.device_id).trim() !== '';
    const wallet = isGuestUnclaimed
      ? deviceBalanceMap.get(String(r.device_id))
      : balanceMap.get(r.user_id != null ? String(r.user_id) : '');
    return {
      subscription_id: r.subscription_id,
      user_id: r.user_id,
      device_id: r.device_id,
      is_guest_unclaimed: isGuestUnclaimed,
      claimed_at: r.claimed_at != null ? formatIsoDate(r.claimed_at) : null,
      user_name: r.user_name,
      subscription_event_type_key: subscriptionEventTypeKey,
      subscription_event_type: labelForSubscriptionEventTypeKey(subscriptionEventTypeKey),
      purchase_or_start_at: formatIsoDate(r.purchase_or_start_at),
      next_recurring_or_renewal_at: formatIsoDate(r.current_period_end || r.renews_at || r.end_at),
      payment_platform: formatPlatformLabel(r.linked_client_platform),
      payment_gateway: formatGatewayLabel(r.linked_order_gateway, r.subscription_provider),
      subscription_status:
        r._display_status != null && String(r._display_status).trim() !== ''
          ? String(r._display_status)
          : displaySubscriptionStatus(r),
      plan_credits: credits,
      plan_bonus_credits: bonus_credits,
      credit_balance: wallet ? wallet.balance : 0,
      credit_reserved_balance: wallet ? wallet.reserved_balance : 0
    };
  });
}

function toCalendarDate(d, clientTz) {
  return TimezoneService.toCalendarYmdInTz(d, clientTz);
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

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);
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

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);
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

/** GET /admin/orders/analytics/volume-summary — total orders + distinct users (created_at in range). */
exports.getOrdersVolumeSummary = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);
    const productType = q.product_type != null && String(q.product_type).trim() !== '' ? String(q.product_type).trim() : '';
    const paymentGateway =
      q.payment_gateway != null && String(q.payment_gateway).trim() !== '' ? String(q.payment_gateway).trim() : '';

    let ppIds = null;
    if (productType) {
      ppIds = await OrdersModel.getPpIdsMatchingProductType(productType);
      if (ppIds.length === 0) {
        return res.status(HTTP_STATUS_CODES.OK).json({ data: { total_orders: 0, unique_users: 0 } });
      }
    }

    const summary = await OrdersAnalyticsModel.getOrdersVolumeSummary({
      startCal,
      endCal,
      tz,
      ppIds,
      paymentGateway: paymentGateway || undefined,
      productTypeLedger: productType || ''
    });

    return res.status(HTTP_STATUS_CODES.OK).json({ data: summary });
  } catch (err) {
    console.error('getOrdersVolumeSummary error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load order volume summary' });
  }
};

/**
 * GET /admin/orders/analytics/subscription-purchases-daily
 * Recurring subscription events per calendar day in tz, split into:
 *   - `initial`  → first-time recurring subscription rows
 *   - `renewal`  → rows tagged with previous_subscription_id / renewal_count > 0
 *   - `count`    → initial + renewal (for back-compat with the single-bar chart)
 *
 * Sourced from `subscriptions` (not `orders`) so RC/Apple/Google renewals,
 * which don't always create a fresh `orders` row, are included.
 */
exports.getSubscriptionPurchasesDaily = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);

    const data = await SubscriptionsAnalyticsModel.getSubscriptionEventsDaily({
      startCal,
      endCal,
      tz
    });

    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    console.error('getSubscriptionPurchasesDaily error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load subscription purchase analytics' });
  }
};

/** GET /admin/orders/analytics/user-subscriptions — paginated subscription rows in date range (JSON). */
exports.getUserSubscriptionsTable = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tz)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);
    const clientPlatform = q.client_platform != null ? String(q.client_platform).trim().toLowerCase() : '';
    let paymentPlanId = null;
    const rawPp = q.payment_plan_id;
    if (rawPp != null && String(rawPp).trim() !== '') {
      const n = parseInt(String(rawPp).trim(), 10);
      if (Number.isFinite(n) && n > 0) paymentPlanId = n;
    }

    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const offset = (page - 1) * limit;

    const subscriptionEventType = normalizeSubscriptionEventTypeFilter(q.subscription_event_type);
    const subscriptionStatus =
      q.subscription_status != null && String(q.subscription_status).trim() !== ''
        ? String(q.subscription_status).trim().toLowerCase()
        : '';

    const { rows, total } = await SubscriptionsAnalyticsModel.listUserSubscriptionsForAdminRange({
      startCal,
      endCal,
      tz,
      clientPlatform: clientPlatform || '',
      paymentPlanId,
      subscriptionEventType,
      subscriptionDisplayStatus: subscriptionStatus,
      limit,
      offset,
      useMaster: true
    });
    const providerPlanIds = (rows || []).map((r) => r.provider_plan_id);
    const planMap = await SubscriptionsAnalyticsModel.resolvePlanMetadataForProviderPlanIds(providerPlanIds, {
      useMaster: true
    });
    const userIds = [...new Set((rows || []).map((r) => r.user_id).filter((id) => id != null))];
    const deviceIds = [
      ...new Set(
        (rows || [])
          .filter((r) => r.user_id == null && r.device_id != null && String(r.device_id).trim() !== '')
          .map((r) => String(r.device_id).trim())
      )
    ];
    const [balanceMap, deviceBalanceMap] = await Promise.all([
      CreditsModel.getBalancesByUserIds(userIds, { useMaster: true }),
      CreditsModel.getBalancesByDeviceIds(deviceIds, { useMaster: true })
    ]);
    const items = buildSubscriptionRowDtos(rows, planMap, balanceMap, deviceBalanceMap);
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        items,
        total,
        page,
        limit
      }
    });
  } catch (err) {
    console.error('getUserSubscriptionsTable error:', err);
    return res
      .status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: 'Failed to load subscription table' });
  }
};

function buildPurchasingCustomerUserDetails(row) {
  const details = {};
  if (row.user_display_name != null && String(row.user_display_name).trim()) {
    details.display_name = String(row.user_display_name).trim();
  }
  if (row.user_first_name != null && String(row.user_first_name).trim()) {
    details.first_name = String(row.user_first_name).trim();
  }
  if (row.user_last_name != null && String(row.user_last_name).trim()) {
    details.last_name = String(row.user_last_name).trim();
  }
  if (row.user_email != null && String(row.user_email).trim()) {
    details.email = String(row.user_email).trim();
  }
  if (row.user_mobile != null && String(row.user_mobile).trim()) {
    details.mobile = String(row.user_mobile).trim();
  }
  return Object.keys(details).length ? details : null;
}

/** GET /admin/orders/analytics/purchase-events-daily — deduped purchase events per calendar day (MySQL). */
exports.getPurchaseEventsDaily = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);

    const [daily, summary] = await Promise.all([
      OrdersAnalyticsModel.getDedupedPurchaseEventsDaily({ startCal, endCal, tz }),
      OrdersAnalyticsModel.getDedupedPurchaseEventsSummary({ startCal, endCal, tz })
    ]);

    return res.status(HTTP_STATUS_CODES.OK).json({ data: daily, summary });
  } catch (err) {
    console.error('getPurchaseEventsDaily error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load purchase events' });
  }
};

/** GET /admin/orders/analytics/purchasing-customers — purchasers in date range (paginated). */
exports.getPurchasingCustomersTable = async function (req, res) {
  try {
    const q = req.validatedQuery;
    const tzRaw = q.tz && String(q.tz).trim() ? String(q.tz).trim() : TimezoneService.getDefaultTimezone();
    const tz = normalizeMysqlTimezone(tzRaw);
    if (!TimezoneService.isValidTimezone(tzRaw)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid timezone' });
    }

    const startCal = toCalendarDate(q.start_date, tz);
    const endCal = toCalendarDate(q.end_date, tz);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
    const offset = (page - 1) * limit;
    const search = q.search != null ? String(q.search).trim() : '';

    const sortBy = q.sort != null ? String(q.sort).trim() : 'last_purchased_at';
    const sortDir = q.sort_dir != null ? String(q.sort_dir).trim().toLowerCase() : 'desc';
    const rangeField =
      q.range_field != null && String(q.range_field).trim() !== ''
        ? String(q.range_field).trim()
        : '';
    const rangeMin =
      q.range_min != null && q.range_min !== '' && Number.isFinite(Number(q.range_min))
        ? Math.floor(Number(q.range_min))
        : null;
    const rangeMax =
      q.range_max != null && q.range_max !== '' && Number.isFinite(Number(q.range_max))
        ? Math.floor(Number(q.range_max))
        : null;

    const { rows, total, summary } = await OrdersAnalyticsModel.listPurchasingCustomersForAdmin({
      startCal,
      endCal,
      tz,
      search,
      limit,
      offset,
      sortBy,
      sortDir,
      rangeField: rangeField || undefined,
      rangeMin,
      rangeMax,
      useMaster: true
    });

    const guestDeviceById = await stitchGuestDeviceDetailsForRows(rows);

    const items = (rows || []).map((row) => {
      const isGuestUnclaimed =
        row.user_id == null && row.device_id != null && String(row.device_id).trim() !== '';
      const deviceId = row.device_id != null ? String(row.device_id).trim() : '';
      const guestDeviceDetails =
        isGuestUnclaimed && deviceId ? guestDeviceById.get(deviceId) || null : null;

      return {
        user_id: row.user_id,
        device_id: row.device_id,
        is_guest_unclaimed: isGuestUnclaimed,
        is_guest_device: isGuestUnclaimed,
        purchaser_key: row.purchaser_key != null ? String(row.purchaser_key) : null,
        user_name: row.user_name != null ? String(row.user_name) : null,
        guest_display_name:
          isGuestUnclaimed && deviceId ? formatGuestDeviceDisplayName(deviceId) : null,
        guest_device_details: guestDeviceDetails,
        user_details: buildPurchasingCustomerUserDetails(row),
        last_purchased_at: formatIsoDate(row.last_purchased_at),
        alacarte_purchases: Number(row.alacarte_purchases) || 0,
        addon_purchases: Number(row.addon_purchases) || 0,
        subscription_purchases: Number(row.subscription_purchases) || 0,
        total_purchases: Number(row.total_purchases) || 0,
        credit_balance: Number(row.credit_balance) || 0,
        credit_reserved_balance: Number(row.credit_reserved_balance) || 0
      };
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        items,
        total,
        page,
        limit,
        summary: {
          alacarte_purchases: Number(summary?.alacarte_purchases) || 0,
          addon_purchases: Number(summary?.addon_purchases) || 0,
          subscription_purchases: Number(summary?.subscription_purchases) || 0,
          total_purchases: Number(summary?.total_purchases) || 0
        }
      }
    });
  } catch (err) {
    console.error('getPurchasingCustomersTable error:', err);
    return res
      .status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: 'Failed to load purchasing customers' });
  }
};
