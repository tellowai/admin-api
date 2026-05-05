'use strict';

const AnalyticsModel = require('../../analytics/models/analytics.model');

const NULL_CTX = {
  analytics_app_version: null,
  analytics_os_name: null,
  analytics_os_version: null
};

/**
 * @param {Array<{ order_id?: unknown }>} mysqlRows — any rows with numeric order_id
 * @returns {Promise<Map<string, { analytics_app_version, analytics_os_name, analytics_os_version }>>}
 */
async function fetchLifecycleContextMapForOrderRows(mysqlRows) {
  const ids = [
    ...new Set(
      (mysqlRows || [])
        .map((r) => r.order_id)
        .filter((id) => id != null && id !== '')
    )
  ];
  if (!ids.length) return new Map();
  return AnalyticsModel.fetchOrderLifecycleDeviceContextByOrderIds(ids);
}

/**
 * @param {Object} orderPayload — already-shaped order object for API
 * @param {Map<string, { analytics_app_version, analytics_os_name, analytics_os_version }>} ctxMap
 */
function applyLifecycleContextToOrderPayload(orderPayload, ctxMap) {
  if (!orderPayload || orderPayload.order_id == null) {
    return orderPayload;
  }
  const ctx = ctxMap.get(String(orderPayload.order_id));
  if (!ctx) {
    return { ...orderPayload, ...NULL_CTX };
  }
  return { ...orderPayload, ...ctx };
}

module.exports = {
  fetchLifecycleContextMapForOrderRows,
  applyLifecycleContextToOrderPayload
};
