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

exports.validateMulticharacterInpainting = function(req, res, next) {
  const schema = Joi.object({
    user_characters: Joi.array().items(
      Joi.object({
        id: Joi.string().required(),
        gender: Joi.string().valid('male', 'female', 'other').required(),
        prompt: Joi.string().required(),
        mask_prompt: Joi.string().allow(null, '').optional()
          .custom((value, helpers) => {
            if (!value) {
              return helpers.omit();
            }
            return value;
          })
      })
    ).required(),
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
    output_format: Joi.string().optional(),
    enable_safety_checker: Joi.boolean().optional()
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

exports.validateVideoFlowComposer = function(req, res, next) {
  const clipSchema = Joi.object({
    clip_index: Joi.number().integer().min(1).required(),
    video_type: Joi.string().valid('ai', 'static').required(),
    created_at: Joi.string().isoDate().required(),
    updated_at: Joi.string().isoDate().required(),
    // AI video specific fields
    video_prompt: Joi.string().when('video_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    video_ai_model: Joi.string().when('video_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    video_quality: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').when('video_type', {
      is: 'ai',
      then: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').default('360p'),
      otherwise: Joi.forbidden()
    }),
    characters: Joi.array().items(
      Joi.object({
        character: Joi.object({
          character_id: Joi.string().required(),
          character_name: Joi.string().required(),
          character_gender: Joi.string().valid('male', 'female', 'other').required()
        }).required(),
        character_prompt: Joi.string().required(),
        character_mask_prompt: Joi.string().allow(null, '').optional()
      })
    ).when('video_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    reference_image_type: Joi.string().valid('ai', 'upload').when('video_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    reference_image_ai_model: Joi.string().when('reference_image_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    template_image_asset_key: Joi.string().when('reference_image_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    template_image_asset_bucket: Joi.string().when('reference_image_type', {
      is: 'ai',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    reference_image_file_asset_key: Joi.string().when('reference_image_type', {
      is: 'upload',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    reference_image_file_asset_bucket: Joi.string().when('reference_image_type', {
      is: 'upload',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    // Static video specific fields
    video_file_asset_key: Joi.string().when('video_type', {
      is: 'static',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    video_file_asset_bucket: Joi.string().when('video_type', {
      is: 'static',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    requires_user_input: Joi.boolean().when('video_type', {
      is: 'static',
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    }),
    custom_input_fields: Joi.array().items(
      Joi.object({
        label: Joi.string().required(),
        type: Joi.string().valid('text', 'image', 'video').required(),
        configuration: Joi.object({
          position: Joi.object({
            x: Joi.number().required(),
            y: Joi.number().required()
          }).required(),
          font: Joi.object({
            family: Joi.string().required(),
            size: Joi.number().required(),
            weight: Joi.string().required()
          }).required(),
          color: Joi.object({
            font: Joi.string().required(),
            background: Joi.string().allow(null).required()
          }).required()
        }).required()
      })
    ).when('requires_user_input', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
  });

  const schema = Joi.object({
    clips: Joi.array().items(clipSchema).min(1).required()
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

exports.validateWorkflowQueue = function(req, res, next) {
  const fileUploadValueSchema = Joi.object({
    asset_key: Joi.string().required(),
    asset_bucket: Joi.string().required(),
    asset_r2_url: Joi.string().uri().required()
  });

  const workflowDataSchema = Joi.object({
    type: Joi.string().valid('ai_model', 'prompt', 'file_upload', 'character_gender', 'grow', 'blur').required(),
    value: Joi.alternatives().conditional('type', {
      is: 'file_upload',
      then: fileUploadValueSchema,
      otherwise: Joi.alternatives().try(Joi.string(), Joi.number()).required()
    }).required()
  });

  const workflowSchema = Joi.object({
    workflow_id: Joi.string().required(),
    workflow_code: Joi.string().required(),
    order_index: Joi.number().integer().min(0).required(),
    data: Joi.array().items(workflowDataSchema).required()
  });

  const clipSchema = Joi.object({
    clip_index: Joi.number().integer().min(1).required(),
    asset_type: Joi.string().valid('image', 'video').required(),
    workflow: Joi.array().items(workflowSchema).min(1).required()
  });

  const uploadedAssetSchema = Joi.object({
    asset_key: Joi.string().required(),
    asset_bucket: Joi.string().required()
  });

  const schema = Joi.object({
    clips: Joi.array().items(clipSchema).min(1).required(),
    template_id: Joi.string().required(),
    uploaded_assets: Joi.array().items(uploadedAssetSchema).optional(),
    user_character_ids: Joi.array().items(Joi.string()).optional()
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