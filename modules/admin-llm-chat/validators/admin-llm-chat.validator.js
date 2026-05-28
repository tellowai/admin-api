'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const schema = require('./schema/admin-llm-chat.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

function makeValidator(joiSchema) {
  return function (req, res, next) {
    const payloadValidation = validationCtrl.validate(joiSchema, req.body);
    if (payloadValidation.error && payloadValidation.error.length) {
      return res.status(HTTP_CODES.BAD_REQUEST).json({
        message: req.t('validation:VALIDATION_FAILED'),
        data: payloadValidation.error,
      });
    }
    req.validatedBody = payloadValidation.value;
    return next();
  };
}

exports.validateCreateConversation = makeValidator(schema.createConversationSchema);
exports.validatePatchConversation = makeValidator(schema.patchConversationSchema);
exports.validateStreamMessage = makeValidator(schema.streamMessageSchema);
exports.validatePresignAttachment = makeValidator(schema.presignAttachmentSchema);
exports.validateRegisterAttachment = makeValidator(schema.registerAttachmentSchema);
exports.validateBusinessContext = makeValidator(schema.businessContextSchema);
exports.validateDigest = makeValidator(schema.digestSchema);
