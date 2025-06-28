'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateMergeVideos = async function(req, res, next) {
  try {
    const schema = Joi.object({
      clips: Joi.array().items(
        Joi.object({
          asset_key: Joi.string().required(),
          asset_bucket: Joi.string().required(),
          clip_index: Joi.number().integer().min(0).required()
        })
      ).min(2).required(),
      sounds: Joi.array().items(
        Joi.object({
          asset_key: Joi.string().required(),
          asset_bucket: Joi.string().required(),
          sound_index: Joi.number().integer().min(0).required()
        })
      ).min(1).required()
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    // Sort clips by clip_index to ensure proper order
    value.clips = value.clips.sort((a, b) => a.clip_index - b.clip_index);

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('video_editing:INVALID_REQUEST_DATA')
    });
  }
}; 