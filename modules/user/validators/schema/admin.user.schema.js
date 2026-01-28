const Joi = require('@hapi/joi');
const { ROLES } = require('../../../auth/constants/permissions.constants');

// Assignable role names (owner is not assignable via UI/API)
const ASSIGNABLE_ROLES = [ROLES.ADMIN, ROLES.EDITOR];

const newAdminUserSchema = Joi.object().keys({
    user_id: Joi.string().max(255).required(),
    roles: Joi.array().items(
        Joi.string().valid(...ASSIGNABLE_ROLES).max(255)
    ).max(25)
});

const bulkRemoveAdminUserSchema = Joi.object().keys({
    user_ids: Joi.array().items(
        Joi.string()
    ).max(25).required()
});

const updateUserRolesSchema = Joi.object().keys({
    roles: Joi.array().items(
        Joi.string().valid(...ASSIGNABLE_ROLES).max(255)
    ).max(25).required()
});

exports.newAdminUserSchema = newAdminUserSchema;
exports.bulkRemoveAdminUserSchema = bulkRemoveAdminUserSchema;
exports.updateUserRolesSchema = updateUserRolesSchema;
