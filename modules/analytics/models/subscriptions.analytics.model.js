'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Recurring subscriptions entitled to access at a point in time (UTC),
 * aligned with api subscription.model recurringRowIsEntitled semantics.
 */
class SubscriptionsAnalyticsModel {
  /**
   * Recurring subscriptions whose entitlement window overlaps [rangeStartUtc, rangeEndUtc]
   * (UTC). Uses the same status / period-end rules as {@link countRecurringEntitledAt}, but
   * counts rows active for any instant in the range instead of only at range end.
   */
  static async countRecurringEntitledOverlappingRange(rangeStartUtcDatetime, rangeEndUtcDatetime) {
    const query = `
      SELECT COUNT(*) AS cnt
      FROM subscriptions
      WHERE payment_type = 'recurring'
        AND COALESCE(start_at, created_at) <= ?
        AND (
          COALESCE(current_period_end, renews_at, end_at) IS NULL
          OR COALESCE(current_period_end, renews_at, end_at) > ?
        )
        AND (
          (
            status IN (
              'active', 'renewed', 'pending', 'trial', 'paused', 'upgraded',
              'active_non_recurring', 'upgraded_non_recurring',
              'pending_otp_verification_for_upgrade'
            )
          )
          OR (
            status = 'cancelled'
            AND COALESCE(current_period_end, renews_at, end_at) IS NOT NULL
          )
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [
      rangeEndUtcDatetime,
      rangeStartUtcDatetime
    ]);
    return Number(rows[0]?.cnt || 0);
  }

  static async countRecurringEntitledAt(asOfUtcDatetime) {
    const query = `
      SELECT COUNT(*) AS cnt
      FROM subscriptions
      WHERE payment_type = 'recurring'
        AND COALESCE(start_at, created_at) <= ?
        AND (
          (
            status IN (
              'active', 'renewed', 'pending', 'trial', 'paused', 'upgraded',
              'active_non_recurring', 'upgraded_non_recurring',
              'pending_otp_verification_for_upgrade'
            )
            AND (
              COALESCE(current_period_end, renews_at, end_at) IS NULL
              OR COALESCE(current_period_end, renews_at, end_at) > ?
            )
          )
          OR (
            status = 'cancelled'
            AND COALESCE(current_period_end, renews_at, end_at) IS NOT NULL
            AND COALESCE(current_period_end, renews_at, end_at) > ?
          )
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [
      asOfUtcDatetime,
      asOfUtcDatetime,
      asOfUtcDatetime
    ]);
    return Number(rows[0]?.cnt || 0);
  }
}

module.exports = SubscriptionsAnalyticsModel;
