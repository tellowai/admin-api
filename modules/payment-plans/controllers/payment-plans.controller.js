'use strict';

const PaymentPlansModel = require('../models/payment-plans.model');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');

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

    return res.status(CODES.OK).json({
      message: req.t('payment_plans:PLAN_UPDATED')
    });
  } catch (err) {
    return handleError(res, err, req.t('payment_plans:UPDATE_FAILED'));
  }
};
