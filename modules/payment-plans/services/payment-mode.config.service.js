'use strict';

const { runQueryInMaster, runQueryInSlave } = require('../../core/models/mysql.promise.model');
const logger = require('../../../config/lib/logger');

class PaymentModeConfigService {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = 0;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  async _getConfig() {
    if (this.cache && (Date.now() - this.cacheTimestamp < this.CACHE_TTL)) {
      return this.cache;
    }

    try {
      const query = `SELECT config_key, config_value FROM payment_mode_config WHERE is_active = 1`;
      const rows = await runQueryInSlave(query, []);

      const defaults = {
        active_mode: 'both',
        allow_subscriptions: true,
        allow_one_time_purchases: true,
        allow_alacarte: true,
        subscription_providers: ['revenuecat'],
        alacarte_providers: ['revenuecat'],
        one_time_providers: ['revenuecat','razorpay', 'dodopayments', 'google_play', 'apple_iap'],
        // Per-platform provider overrides
        ios_subscription_providers: ['revenuecat'],
        android_subscription_providers: ['revenuecat'],
        ios_alacarte_providers: ['revenuecat'],
        android_alacarte_providers: ['revenuecat'],
        ios_one_time_providers: ['revenuecat'],
        android_one_time_providers: ['google_play'],
      };

      const configMap = { ...defaults };
      for (const row of rows) {
        try {
          configMap[row.config_key] = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
        } catch (e) {
          logger.error(`Error parsing config_value for key ${row.config_key}:`, e);
        }
      }

      this.cache = configMap;
      this.cacheTimestamp = Date.now();
      return this.cache;
    } catch (error) {
      logger.error('Error fetching payment mode config from DB:', error);
      if (this.cache) return this.cache;

      return {
        active_mode: 'both',
        allow_subscriptions: true,
        allow_one_time_purchases: true,
        allow_alacarte: true,
        subscription_providers: ['revenuecat'],
        alacarte_providers: ['revenuecat'],
        one_time_providers: ['razorpay', 'dodopayments', 'google_play', 'apple_iap']
      };
    }
  }

  async getAllConfig() {
    return this._getConfig();
  }

  async getActivePaymentMode() {
    const config = await this._getConfig();
    return config['active_mode'] || 'both';
  }

  async isSubscriptionEnabled() {
    const config = await this._getConfig();
    return config['allow_subscriptions'] !== false;
  }

  async isOneTimeEnabled() {
    const config = await this._getConfig();
    return config['allow_one_time_purchases'] !== false;
  }

  async isAlacarteEnabled() {
    const config = await this._getConfig();
    return config['allow_alacarte'] !== false;
  }

  async getEnabledProviders(type) {
    const config = await this._getConfig();
    switch (type) {
      case 'subscription': return config['subscription_providers'] || ['revenuecat'];
      case 'alacarte': return config['alacarte_providers'] || ['revenuecat'];
      case 'one_time': return config['one_time_providers'] || ['razorpay', 'dodopayments', 'google_play', 'apple_iap'];
      default: return [];
    }
  }

  async updateConfig(key, value) {
    try {
      const query = `
        INSERT INTO payment_mode_config (config_key, config_value, is_active) 
        VALUES (?, ?, 1) 
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
      `;
      const jsonValue = JSON.stringify(value);
      await runQueryInMaster(query, [key, jsonValue]);

      this.cache = null;
      this.cacheTimestamp = 0;

      logger.info(`Updated payment config key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error updating payment config key ${key}:`, error);
      throw error;
    }
  }
}

module.exports = new PaymentModeConfigService();
