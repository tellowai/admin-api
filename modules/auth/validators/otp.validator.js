const validationCtrl = require('../../core/controllers/validation.controller');
const otpBasedLoginSchema = require('./schema/otp.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;


exports.validateLoginMultiData = function(req, res, next) {
    const payload = req.body;

    const payloadValidation = validationCtrl.validate(otpBasedLoginSchema.loginMultiSchema, payload);

    if(payloadValidation.error && payloadValidation.error.length) {

        return res.status(HTTP_CODES.BAD_REQUEST).json({
            message: req.t('validation:VALIDATION_FAILED'),
            data: payloadValidation.error
        });
    }

    req.validatedBody = payloadValidation.value;
    return next(null);
};

exports.validateVerifyOTPLoginMultiData = function(req, res, next) {
    const payload = req.body;

    const payloadValidation = validationCtrl.validate(otpBasedLoginSchema.verifyOTPLoginMultiSchema, payload);

    if(payloadValidation.error && payloadValidation.error.length) {

        return res.status(HTTP_CODES.BAD_REQUEST).json({
            message: req.t('validation:VALIDATION_FAILED'),
            data: payloadValidation.error
        });
    }

    req.validatedBody = payloadValidation.value;
    return next(null);
};
