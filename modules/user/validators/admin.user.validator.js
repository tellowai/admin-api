const validationCtrl = require('../../core/controllers/validation.controller');
const adminUserSchema = require('./schema/admin.user.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;


exports.validateCreateAdminUserData = function(req, res, next) {
    const payload = req.body;
  
    const payloadValidation = validationCtrl.validate(adminUserSchema.newAdminUserSchema, payload);
    
    if(payloadValidation.error && payloadValidation.error.length) {

        return res.status(HTTP_CODES.BAD_REQUEST).json({
            message: req.t('validation:VALIDATION_FAILED'),
            data: payloadValidation.error
        });
    }

    req.validatedBody = payloadValidation.value;
    return next(null);
};

exports.validateBulkRemoveAdminUserData = function(req, res, next) {
    const payload = req.body;
  
    const payloadValidation = validationCtrl.validate(adminUserSchema.bulkRemoveAdminUserSchema, payload);
    
    if(payloadValidation.error && payloadValidation.error.length) {

        return res.status(HTTP_CODES.BAD_REQUEST).json({
            message: req.t('validation:VALIDATION_FAILED'),
            data: payloadValidation.error
        });
    }

    req.validatedBody = payloadValidation.value;
    return next(null);
};
