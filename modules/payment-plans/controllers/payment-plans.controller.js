'use strict';

const PaymentPlansModel = require('../models/payment-plans.model');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');
const ActivityLogController = require('../../core/controllers/activitylog.controller');

// Helper for error handling
const handleError = (res, err, message) => {
  logger.error(message, { error: err.message, stack: err.stack });
  return res.status(CODES.INTERNAL_SERVER_ERROR).send({
    message: message,
    error: err.message
  });
};

exports.listPlans = async function (req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const plans = await PaymentPlansModel.listPlans(paginationParams);

    if (plans.length > 0) {
      const planIds = plans.map(p => p.pp_id);
      const uiConfigs = await PaymentPlansModel.getUIConfigsForPlans(planIds);

      const configMap = new Map();
      uiConfigs.forEach(conf => {
        configMap.set(conf.payment_plan_id, conf);
      });

      plans.forEach(plan => {
        const conf = configMap.get(plan.pp_id);
        if (conf) {
          plan.panel_bg_color = conf.panel_bg_color;
          plan.panel_border_color = conf.panel_border_color;
          plan.panel_glow_color = conf.panel_glow_color;
          plan.button_cta_text = conf.button_cta_text;
          plan.button_bg_color = conf.button_bg_color;
          plan.button_text_color = conf.button_text_color;
          plan.plan_badge = conf.plan_badge;
          plan.plan_badge_bg_color = conf.plan_badge_bg_color;
          plan.plan_badge_border_color = conf.plan_badge_border_color;
          plan.plan_badge_text_color = conf.plan_badge_text_color;
          plan.plan_badge_icon = conf.plan_badge_icon;
        }
      });
    }

    // We are returning plain data for the page, no total counts as per requirement
    return res.status(CODES.OK).json({
      data: plans
    });
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:LIST_FAILED'));
  }
};

exports.getPlan = async function (req, res) {
  try {
    const planId = req.params.planId;
    if (!planId) {
      return res.status(CODES.BAD_REQUEST).send({ message: req.t('payment_plans:PLAN_ID_REQUIRED') });
    }

    const plan = await PaymentPlansModel.getPlanById(planId);

    if (!plan) {
      return res.status(CODES.NOT_FOUND).send({ message: req.t('payment_plans:PLAN_NOT_FOUND') });
    }

    // Stitch related data
    const [gateways, uiConfig] = await Promise.all([
      PaymentPlansModel.getPlanGateways(planId),
      PaymentPlansModel.getPlanUIConfig(planId)
    ]);

    const result = {
      ...plan,
      gateways: gateways,
      ui_config: uiConfig || null
    };

    return res.status(CODES.OK).json(result);
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:GET_FAILED'));
  }
};

exports.createPlan = async function (req, res) {
  try {
    // req.validatedBody is populated by validor middleware
    const planId = await PaymentPlansModel.createPlan(req.validatedBody);

    // Activity Log
    try {
      if (req.user && req.user.userId) {
        await ActivityLogController.publishNewAdminActivityLog({
          adminUserId: req.user.userId,
          entityType: 'payment_plans',
          actionName: 'CREATE_PAYMENT_PLAN',
          entityId: planId,
          additionalData: JSON.stringify({ plan_name: req.validatedBody.plan_name })
        });
      }
    } catch (logErr) {
      logger.error('Failed to log admin activity for create plan', logErr);
    }

    return res.status(CODES.CREATED).json({
      message: req.t('payment_plans:PLAN_CREATED'),
      planId: planId
    });
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:CREATE_FAILED'));
  }
};

exports.updatePlan = async function (req, res) {
  try {
    const planId = req.params.planId;
    if (!planId) {
      return res.status(CODES.BAD_REQUEST).send({ message: req.t('payment_plans:PLAN_ID_REQUIRED') });
    }

    // req.validatedBody is populated by validor middleware
    await PaymentPlansModel.updatePlan(planId, req.validatedBody);

    // Activity Log
    try {
      if (req.user && req.user.userId) {
        await ActivityLogController.publishNewAdminActivityLog({
          adminUserId: req.user.userId,
          entityType: 'payment_plans',
          actionName: 'UPDATE_PAYMENT_PLAN',
          entityId: planId,
          additionalData: JSON.stringify({ plan_name: req.validatedBody.plan_name })
        });
      }
    } catch (logErr) {
      logger.error('Failed to log admin activity for update plan', logErr);
    }

    return res.status(CODES.OK).json({
      message: req.t('payment_plans:PLAN_UPDATED')
    });
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:UPDATE_FAILED'));
  }
};

exports.togglePlanStatus = async function (req, res) {
  try {
    const planId = req.params.planId;
    const { is_active } = req.validatedBody;

    if (!planId) {
      return res.status(CODES.BAD_REQUEST).send({ message: req.t('payment_plans:PLAN_ID_REQUIRED') });
    }

    // Check if plan exists
    const plan = await PaymentPlansModel.getPlanById(planId);
    if (!plan) {
      return res.status(CODES.NOT_FOUND).send({ message: req.t('payment_plans:PLAN_NOT_FOUND') });
    }

    // If deactivating, directly update without validation
    if (is_active === 0) {
      await PaymentPlansModel.updatePlanStatus(planId, 0);

      // Activity Log
      try {
        if (req.user && req.user.userId) {
          await ActivityLogController.publishNewAdminActivityLog({
            adminUserId: req.user.userId,
            entityType: 'payment_plans',
            actionName: 'DEACTIVATE_PAYMENT_PLAN',
            entityId: planId,
            additionalData: JSON.stringify({ plan_name: plan.plan_name })
          });
        }
      } catch (logErr) {
        logger.error('Failed to log admin activity for deactivate plan', logErr);
      }

      return res.status(CODES.OK).json({
        message: req.t('payment_plans:PLAN_DEACTIVATED')
      });
    }

    // If activating, validate all mandatory fields
    if (is_active === 1) {
      const errors = [];

      // Validate plan_name
      if (!plan.plan_name || plan.plan_name.trim() === '') {
        errors.push({ field: 'plan_name', message: 'Plan name is required' });
      }

      // Validate tier
      if (!plan.tier || !['premium', 'ai', 'unified'].includes(plan.tier)) {
        errors.push({ field: 'tier', message: 'Tier must be one of: premium, ai, unified' });
      }

      // Validate plan_type
      if (!plan.plan_type || !['single', 'bundle', 'credits'].includes(plan.plan_type)) {
        errors.push({ field: 'plan_type', message: 'Plan type must be one of: single, bundle, credits' });
      }

      // Validate current_price
      if (plan.current_price === null || plan.current_price === undefined || plan.current_price < 0) {
        errors.push({ field: 'current_price', message: 'Current price must be greater than or equal to 0' });
      }

      // Validate currency
      if (!plan.currency || plan.currency.trim() === '') {
        errors.push({ field: 'currency', message: 'Currency is required' });
      }

      // Validate billing_interval
      if (!plan.billing_interval || plan.billing_interval.trim() === '') {
        errors.push({ field: 'billing_interval', message: 'Billing interval is required' });
      }

      // Validate validity_days
      if (!plan.validity_days || plan.validity_days <= 0) {
        errors.push({ field: 'validity_days', message: 'Validity days must be greater than 0' });
      }

      // Validate gateways - at least one active gateway required
      const gateways = await PaymentPlansModel.getPlanGateways(planId);
      const activeGateways = gateways.filter(g => g.is_active === 1 && g.pg_plan_id && g.pg_plan_id.trim() !== '');
      
      if (activeGateways.length === 0) {
        errors.push({ field: 'gateways', message: 'At least one active payment gateway with valid plan ID is required' });
      }

      // If validation errors exist, return them
      if (errors.length > 0) {
        return res.status(CODES.BAD_REQUEST).json({
          message: req.t('payment_plans:ACTIVATION_FAILED'),
          errors: errors
        });
      }

      // All validations passed, activate the plan
      await PaymentPlansModel.updatePlanStatus(planId, 1);

      // Activity Log
      try {
        if (req.user && req.user.userId) {
          await ActivityLogController.publishNewAdminActivityLog({
            adminUserId: req.user.userId,
            entityType: 'payment_plans',
            actionName: 'ACTIVATE_PAYMENT_PLAN',
            entityId: planId,
            additionalData: JSON.stringify({ plan_name: plan.plan_name })
          });
        }
      } catch (logErr) {
        logger.error('Failed to log admin activity for activate plan', logErr);
      }

      return res.status(CODES.OK).json({
        message: req.t('payment_plans:PLAN_ACTIVATED')
      });
    }

    return res.status(CODES.BAD_REQUEST).json({
      message: 'Invalid status value'
    });
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:STATUS_UPDATE_FAILED'));
  }
};
