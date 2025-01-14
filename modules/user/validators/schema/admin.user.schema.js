const Joi = require('@hapi/joi');

const newAdminUserSchema = Joi.object().keys({
    user_id: Joi.string().max(255).required(),
    roles: Joi.array().items(
        Joi.string().valid('manage_users', 'manage_remote_config', 'manage_admin').max(255)
    ).max(25)
});

const bulkRemoveAdminUserSchema = Joi.object().keys({
    user_ids: Joi.array().items(
        Joi.string()
    ).max(25).required()
});

exports.newAdminUserSchema = newAdminUserSchema;
exports.bulkRemoveAdminUserSchema = bulkRemoveAdminUserSchema;
