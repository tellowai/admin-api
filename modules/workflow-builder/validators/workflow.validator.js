'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

// Node type: AI/model types + system node type_slugs from workflow_system_node_definitions (START, END, USER_INPUT_TEXT, etc.).
const NODE_TYPES = [
  'AI_MODEL', 'USER_INPUT', 'STATIC_ASSET', 'LOGIC_GATE', 'OUTPUT', 'SYSTEM',
  'START', 'END', 'USER_INPUT_TEXT', 'USER_INPUT_IMAGE', 'USER_INPUT_VIDEO',
  'STATIC_IMAGE', 'STATIC_VIDEO'
];
const nodeSchema = Joi.object({
  uuid: Joi.string().min(1).max(64).optional(), // Allow any string id (frontend may use readable ids; DB/model use node.uuid ?? node.id ?? uuidv4())
  type: Joi.string().required().valid(...NODE_TYPES),
  amr_id: Joi.number().integer().allow(null),
  system_node_type: Joi.string().allow(null),
  position: Joi.object({
    x: Joi.number().required(),
    y: Joi.number().required()
  }).required(),
  width: Joi.number().default(250),
  height: Joi.number().default(150),
  config_values: Joi.object().default({}),
  ui_metadata: Joi.object().default({})
}).unknown(true); // Allow other fields that might be passed from frontend

const edgeSchema = Joi.object({
  uuid: Joi.string().min(1).max(64).optional(), // Allow any string id
  source: Joi.string().required(),
  sourceHandle: Joi.string().required(),
  target: Joi.string().required(),
  targetHandle: Joi.string().required(),
  type: Joi.string().default('default'),
  animated: Joi.boolean().default(false)
}).unknown(true);

exports.validateCreateWorkflow = function (req, res, next) {
  const schema = Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().max(1000).allow(null, '')
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

exports.validateUpdateWorkflow = function (req, res, next) {
  const schema = Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().max(1000).allow(null, '').optional(),
    status: Joi.string().valid('draft', 'published', 'archived').optional()
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

exports.validateAutoSave = function (req, res, next) {
  const schema = Joi.object({
    nodes: Joi.array().items(nodeSchema).default([]),
    edges: Joi.array().items(edgeSchema).default([]),
    viewport: Joi.object({
      x: Joi.number(),
      y: Joi.number(),
      zoom: Joi.number()
    }).default({ x: 0, y: 0, zoom: 1 }),
    changeHash: Joi.string().allow(null),
    templateId: Joi.string().uuid().optional(),
    clipIndex: Joi.number().integer().min(0).optional(),
    assetType: Joi.string().valid('image', 'video').optional()
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

exports.validateSaveWorkflow = function (req, res, next) {
  const schema = Joi.object({
    nodes: Joi.array().items(nodeSchema).required(),
    edges: Joi.array().items(edgeSchema).default([]),
    viewport: Joi.object({
      x: Joi.number(),
      y: Joi.number(),
      zoom: Joi.number()
    }).default({ x: 0, y: 0, zoom: 1 }),
    metadata: Joi.object({
      name: Joi.string().min(1).max(255),
      description: Joi.string().max(1000).allow(null, '')
    }).default({}),
    templateId: Joi.string().uuid().optional(),
    clipIndex: Joi.number().integer().min(0).optional(),
    assetType: Joi.string().valid('image', 'video').optional()
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

/** tac_id param (template_ai_clips id) */
exports.validateTacIdParam = function (req, res, next) {
  const tacId = req.params.tacId;
  if (!tacId || typeof tacId !== 'string' || tacId.trim().length === 0) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: 'tacId is required'
    });
  }
  next();
};
