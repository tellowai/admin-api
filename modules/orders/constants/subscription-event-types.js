'use strict';

/** Stable filter / SQL keys for admin subscription event classification. */
const SUBSCRIPTION_EVENT_TYPE_KEYS = Object.freeze({
  RENEWAL: 'renewal',
  INITIAL: 'initial',
  UPGRADE: 'upgrade',
  ONE_TIME: 'one_time'
});

/** User-facing labels (table, filters, charts). */
const SUBSCRIPTION_EVENT_TYPE_LABELS = Object.freeze({
  renewal: 'Subscription renewal',
  initial: 'New subscription',
  upgrade: 'Plan upgrade',
  one_time: 'One-time purchase'
});

/** Legacy API / SQL values accepted for backward compatibility. */
const LEGACY_SUBSCRIPTION_EVENT_TYPE_TO_KEY = Object.freeze({
  Renewal: 'renewal',
  'Subscription initial': 'initial',
  Upgrade: 'upgrade',
  'One-time': 'one_time'
});

function normalizeSubscriptionEventTypeFilter(value) {
  if (value == null || String(value).trim() === '') return '';
  const s = String(value).trim();
  if (Object.values(SUBSCRIPTION_EVENT_TYPE_KEYS).includes(s)) return s;
  return LEGACY_SUBSCRIPTION_EVENT_TYPE_TO_KEY[s] || '';
}

function labelForSubscriptionEventTypeKey(key) {
  if (key == null || String(key).trim() === '') return '';
  return SUBSCRIPTION_EVENT_TYPE_LABELS[String(key).trim()] || String(key).trim();
}

const ALL_SUBSCRIPTION_EVENT_TYPE_FILTER_VALUES = Object.freeze([
  '',
  ...Object.values(SUBSCRIPTION_EVENT_TYPE_KEYS),
  ...Object.keys(LEGACY_SUBSCRIPTION_EVENT_TYPE_TO_KEY)
]);

module.exports = {
  SUBSCRIPTION_EVENT_TYPE_KEYS,
  SUBSCRIPTION_EVENT_TYPE_LABELS,
  LEGACY_SUBSCRIPTION_EVENT_TYPE_TO_KEY,
  ALL_SUBSCRIPTION_EVENT_TYPE_FILTER_VALUES,
  normalizeSubscriptionEventTypeFilter,
  labelForSubscriptionEventTypeKey
};
