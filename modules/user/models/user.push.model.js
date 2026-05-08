'use strict';

/**
 * FCM tokens for mobile app users (shared DB with photobop-api).
 * Used by admin-api to notify customers when support replies.
 */

var mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Active FCM device tokens for outbound pushes.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
exports.getActiveFcmTokensByUserId = async function (userId) {
  const query = `
    SELECT DISTINCT fcm_token AS fcm_token
    FROM user_notification_subscription
    WHERE user_id = ?
      AND fcm_token IS NOT NULL
      AND TRIM(fcm_token) <> ''
      AND is_subscribed = 1
      AND (is_device_active IS NULL OR is_device_active = 1)
      AND deleted_at IS NULL
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [userId]);
  if (!rows || !rows.length) {
    return [];
  }
  return rows.map((r) => r.fcm_token).filter(Boolean);
};

/**
 * Mark a stale/invalid FCM token inactive so outbound pushes skip it.
 * @param {string} fcmToken
 * @returns {Promise<void>}
 */
exports.deactivateFcmToken = async function (fcmToken) {
  if (!fcmToken) {
    return;
  }
  const query = `
    UPDATE user_notification_subscription
    SET is_device_active = 0, updated_at = NOW()
    WHERE fcm_token = ?
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [fcmToken]);
};
