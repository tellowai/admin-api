const Joi = require('@hapi/joi');


exports.loginMultiSchema = Joi.object().keys({
    contact_type: Joi.string().valid('mobile').required(),
    contact_value: Joi.string().required(),
    clientId: Joi.string().max(255).required()
});

exports.verifyOTPLoginMultiSchema = Joi.object().keys({
    contact_type: Joi.string().valid('mobile').required(),
    contact_value: Joi.string().required(),
    clientId: Joi.string().max(255).required(),
    otp: Joi.string().length(4).pattern(/^\d{4}$/).required()
});
