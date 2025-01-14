const Joi = require('@hapi/joi');

const emailOnlySchema = Joi.object({
    email: Joi.string()
      .email()
      .required()
});

exports.emailOnlySchema = emailOnlySchema;


const resetPwdSchema = Joi.object({
  resetPasswordToken: Joi.string().required(),
  newPassword: Joi.string()
    .min(7)
    .max(32)
    .required(),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
});

exports.resetPwdSchema = resetPwdSchema;


const changePwdSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(7)
    .max(32)
    .required(),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
});

exports.changePwdSchema = changePwdSchema;


const credentials = Joi.object({
  email : Joi.string()
    .email()
    .min(3)
    .max(255)
    .required(),
  password : Joi.string()
    .required()
});

exports.authenticateUser = credentials;
