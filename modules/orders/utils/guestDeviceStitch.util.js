'use strict';

const CreditsModel = require('../../credits/models/credits.model');
const ManageAdminUserDbo = require('../../user/models/admin.user.model');
const { formatGuestDeviceDisplayName } = require('./guestDeviceDisplay.util');

/**
 * Build admin guest-device profile snapshots keyed by device_id.
 * @param {Array<{ user_id?: unknown, device_id?: unknown }>} rows
 * @returns {Promise<Map<string, object>>}
 */
async function stitchGuestDeviceDetailsForRows(rows) {
  const deviceIds = [
    ...new Set(
      (rows || [])
        .filter((r) => !r.user_id && r.device_id)
        .map((r) => String(r.device_id).trim())
        .filter(Boolean)
    )
  ];
  const map = new Map();
  if (!deviceIds.length) return map;

  const [balanceMap, completedMap, boundsMap] = await Promise.all([
    CreditsModel.getBalancesByDeviceIds(deviceIds),
    ManageAdminUserDbo.countCompletedOrdersByDeviceIds(deviceIds),
    ManageAdminUserDbo.getGuestDeviceOrderBoundsByDeviceIds(deviceIds)
  ]);

  for (const did of deviceIds) {
    const wallet = balanceMap.get(did) || { balance: 0, reserved_balance: 0 };
    const bounds = boundsMap.get(did) || {};
    map.set(did, {
      device_id: did,
      display_name: formatGuestDeviceDisplayName(did),
      credit_balance: wallet.balance,
      credit_reserved_balance: wallet.reserved_balance,
      completed_orders_count: completedMap.get(did) || 0,
      order_count: bounds.order_count || 0,
      first_order_at: bounds.first_order_at || null,
      last_order_at: bounds.last_order_at || null
    });
  }
  return map;
}

module.exports = {
  stitchGuestDeviceDetailsForRows
};
