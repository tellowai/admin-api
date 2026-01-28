'use strict';

const Joi = require('@hapi/joi');

const createRoleSchema = Joi.object().keys({
  role_name: Joi.string().required().min(1).max(255),
  role_description: Joi.string().allow('').max(255).optional()
});

const updateRoleSchema = Joi.object().keys({
  role_name: Joi.string().min(1).max(255).optional(),
  role_description: Joi.string().allow('').max(255).optional()
});

const assignPermissionsSchema = Joi.object().keys({
  permission_ids: Joi.array().items(Joi.string().required()).min(1).required()
});

const updateRolePermissionsSchema = Joi.object().keys({
  permission_ids: Joi.array().items(Joi.string().required()).required()
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  assignPermissionsSchema,
  updateRolePermissionsSchema
};
