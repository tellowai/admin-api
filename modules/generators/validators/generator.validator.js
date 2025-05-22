'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateGenerateImages = async function(req, res, next) {
  try {
    const schema = Joi.object({
      user_character_ids: Joi.array().items(Joi.string()).required(),
      template_id: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_REQUEST_DATA')
    });
  }
};

exports.validatePagination = async function(req, res, next) {
  try {
    const schema = Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(20),
    });

    const { error, value } = schema.validate(req.query);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedQuery = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_REQUEST_DATA')
    });
  }
};

exports.validateGenerateVideos = async function(req, res, next) {
  const schema = Joi.object({
    user_character_ids: Joi.array().items(Joi.string()).required(),
    template_id: Joi.string().required(),
    cf_r2_key: Joi.string().required(),
    cf_r2_url: Joi.string().uri().required()
  });

  try {
    const value = await schema.validateAsync(req.body);
    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: err.details[0].message});
  }
}; 

exports.validateDeleteGeneration = async function(req, res, next) {
  try {
    const schema = Joi.object({
      media_id: Joi.string().required()
    });

    const { error, value } = schema.validate(req.params);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedParams = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_REQUEST_DATA')
    });
  }
}; 

exports.validateRecreateFromAsset = function(req, res, next) {
  const schema = Joi.object({
    asset_key: Joi.string().required(),
    asset_bucket: Joi.string().required(),
    user_character_ids: Joi.array().items(Joi.string()).required()
  });

  const { error, value } = schema.validate(req.body);

  if (error) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.details[0].message
    });
  }

  req.validatedBody = value;
  next();
}; 

exports.validateUpscaleImage = function(req, res, next) {
  const schema = Joi.object({
    asset_key: Joi.string().required(),
    asset_bucket: Joi.string().optional(),
    model_name: Joi.string().valid('clarity', 'outpaint', 'colorize').optional()
  });

  const { error, value } = schema.validate(req.body);

  if (error) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.details[0].message
    });
  }

  req.validatedBody = value;
  next();
}; 

exports.validateCoupleInpainting = function(req, res, next) {
  const schema = Joi.object({
    user_character_ids: Joi.array().items(Joi.string()).required(),
    user_character_genders: Joi.array().items(Joi.string()).required(),
    male_prompt: Joi.string().allow(null, '').optional(),
    female_prompt: Joi.string().allow(null, '').optional(),
    asset_key: Joi.string().required(),
    asset_bucket: Joi.string().required()
  });

  const { error, value } = schema.validate(req.body);

  if (error) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.details[0].message
    });
  }

  req.validatedBody = value;
  next();
}; 

exports.validateTextToImage = function(req, res, next) {
  const schema = Joi.object({
    prompt: Joi.string().required(),
    character_id: Joi.string().optional(),
    imageSize: Joi.string().optional(),
    width: Joi.number().optional(),
    height: Joi.number().optional(),
    num_inference_steps: Joi.string().optional(),
    seed: Joi.string().optional(),
    guidance_scale: Joi.string().optional(),
    num_images: Joi.string().optional(),
    output_format: Joi.string().optional()
  });

  const { error, value } = schema.validate(req.body);

  if (error) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.details[0].message
    });
  }

  req.validatedBody = value;
  next();
}; 