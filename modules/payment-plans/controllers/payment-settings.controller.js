'use strict';

const PaymentModeConfigService = require('../services/payment-mode.config.service');
const ActivityLogController = require('../../core/controllers/activitylog.controller');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');
const logger = require('../../../config/lib/logger');

const handleError = (res, err, message) => {
  logger.error(message, { error: err.message, stack: err.stack });
  return res.status(CODES.INTERNAL_SERVER_ERROR).send({
    message: message,
    error: err.message
  });
};

/**
 * Get all payment settings (Admin)
 */
exports.getAllSettings = async function (req, res) {
  try {
    const config = await PaymentModeConfigService.getAllConfig();
    return res.status(CODES.OK).json({
      message: 'Payment settings retrieved successfully',
      data: config
    });
  } catch (err) {
    return handleError(res, err, 'Failed to retrieve payment settings');
  }
};

/**
 * Update a specific payment setting by key (Admin)
 */
exports.updateSetting = async function (req, res) {
  try {
    const { key } = req.params;
    const value = req.body.value;

    if (!key) {
      return res.status(CODES.BAD_REQUEST).json({ message: 'Setting key is required' });
    }

    if (value === undefined) {
      return res.status(CODES.BAD_REQUEST).json({ message: 'Setting value is required' });
    }

    // Call the generic API service to update the database
    const success = await PaymentModeConfigService.updateConfig(key, value);
    
    if (!success) {
       return res.status(CODES.BAD_REQUEST).json({ message: 'Invalid configuration key' });
    }

    // Log the admin activity
    try {
      if (req.user && req.user.userId) {
        await ActivityLogController.publishNewAdminActivityLog({
          adminUserId: req.user.userId,
          entityType: 'payment_settings',
          actionName: 'UPDATE_SETTING',
          entityId: key,
          additionalData: JSON.stringify({ old_value: 'hidden', new_value: value })
        });
      }
    } catch (logErr) {
      logger.error('Failed to log admin activity for update payment setting', logErr);
    }

    return res.status(CODES.OK).json({
      message: 'Setting updated successfully'
    });
  } catch (err) {
    return handleError(res, err, 'Failed to update payment setting');
  }
};
