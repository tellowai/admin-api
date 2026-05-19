'use strict';

const NicheModel = require('../../niches/models/niche.model');
const LanguageModel = require('../../languages/models/language.model');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const {
  extractCustomTextInputFieldsFromBodymovin,
  summarizeBodymovinForLlm
} = require('../utils/bodymovinTextLayers.utils');

const VALID_GENDERS = ['male', 'female', 'couple', 'unisex'];
const VALID_WORKFLOW_TYPES = ['AI_ONLY', 'AI_PLUS_AE', 'AE_ONLY'];
const VALID_CLIPS_TYPES = ['ai', 'non-ai'];
const VALID_TEMPLATE_TYPES = ['free', 'premium', 'standard', 'exclusive', 'ai'];

/**
 * @api {post} /templates/infer-metadata Infer template general metadata from Bodymovin JSON (LLM)
 * @apiPermission JWT
 */
exports.inferTemplateMetadata = async function (req, res) {
  try {
    const { bodymovin_json: bodymovinJson, template_output_type: outputTypeHint, filename_hint: filenameHint } =
      req.validatedBody;

    const [nicheRows, languageRows] = await Promise.all([
      NicheModel.listNiches({ limit: 100, offset: 0 }),
      LanguageModel.listLanguages({ limit: 200, offset: 0 })
    ]);

    const niches = (nicheRows || []).map((n) => ({
      slug: n.slug,
      name: n.niche_name
    }));
    const languages = (languageRows || []).map((l) => ({
      code: l.code,
      name: l.name
    }));

    const bodymovinSummary = summarizeBodymovinForLlm(bodymovinJson);
    const draftTextFields = extractCustomTextInputFieldsFromBodymovin(bodymovinJson);

    const llmProvider = await LLMProviderFactory.createProvider('openai');

    const systemMessage = {
      role: 'system',
      content: `You infer admin template metadata from After Effects / Bodymovin (Lottie) export context.

RULES:
- template_name: descriptive English title, at least 5 characters, suitable for app listing (not a file name).
- template_gender: one of male, female, couple, unisex — infer from text layer labels and theme (wedding couple → couple, birthday boy → male, etc.).
- template_workflow_type: AE_ONLY when template is pure motion graphics with user text/media slots and no AI generation clips; AI_PLUS_AE when AI generation is implied; AI_ONLY only when clearly AI-first with no AE overlay.
- template_clips_assets_type: "non-ai" for AE-only motion templates; "ai" when template needs AI image/video generation clips.
- template_type: free | premium | standard | exclusive | ai — default premium for paid celebration templates; free only when clearly promotional/simple.
- niche_slug: MUST be one of the provided niche slugs, or null if none fit.
- language_code: MUST be one of the provided language codes (e.g. en, hi) based on default text script/language.
- credits: integer >= 0; use 0 when template_type is free, else typically 1-5 for premium celebration templates.
- is_effects: true only when template is a short visual effect / overlay style (not a full greeting card).
- max_free_generations: only set when template_type is free (positive integer or null).
- description: optional short marketing blurb (1-2 sentences) or null.
- Refine custom_text_input_fields: same count as input; set input_field_type (short_text, long_text, date, time, datetime) and user_input_field_name (clean English labels).

Respond with JSON only matching the schema.`
    };

    const userMessage = {
      role: 'user',
      content: `Infer template metadata.

OUTPUT TYPE HINT (from media analysis): ${outputTypeHint || 'unknown'}
FILENAME HINT: ${filenameHint || 'none'}

AVAILABLE NICHES (slug → name):
${JSON.stringify(niches, null, 2)}

AVAILABLE LANGUAGES (code → name):
${JSON.stringify(languages, null, 2)}

BODYMOVIN SUMMARY:
${JSON.stringify(bodymovinSummary, null, 2)}

DRAFT TEXT FIELDS (refine types and user_input_field_name):
${JSON.stringify(draftTextFields, null, 2)}`
    };

    const responseFormat = {
      schema: {
        type: 'object',
        properties: {
          template_name: { type: 'string' },
          template_gender: { type: 'string', enum: VALID_GENDERS },
          template_workflow_type: { type: 'string', enum: VALID_WORKFLOW_TYPES },
          template_clips_assets_type: { type: 'string', enum: VALID_CLIPS_TYPES },
          template_type: { type: 'string', enum: VALID_TEMPLATE_TYPES },
          niche_slug: { type: ['string', 'null'] },
          language_code: { type: ['string', 'null'] },
          credits: { type: 'number' },
          is_effects: { type: 'boolean' },
          max_free_generations: { type: ['number', 'null'] },
          description: { type: ['string', 'null'] },
          custom_text_input_fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layer_name: { type: 'string' },
                default_text: { type: 'string' },
                input_field_type: {
                  type: 'string',
                  enum: ['short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video']
                },
                user_input_field_name: { type: 'string' },
                linked_layer_names: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['layer_name', 'default_text', 'input_field_type', 'user_input_field_name']
            }
          }
        },
        required: [
          'template_name',
          'template_gender',
          'template_workflow_type',
          'template_clips_assets_type',
          'template_type',
          'credits',
          'is_effects',
          'custom_text_input_fields'
        ]
      },
      schemaName: 'TemplateMetadataInference'
    };

    const llmResponse = await llmProvider.createChatCompletion({
      messages: [systemMessage, userMessage],
      responseFormat
    });

    if (!llmResponse.success) {
      logger.error('Template metadata LLM inference failed:', { error: llmResponse.error });
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to infer template metadata using AI service',
        error: llmResponse.error
      });
    }

    let inferred;
    try {
      inferred = typeof llmResponse.data === 'string' ? JSON.parse(llmResponse.data) : llmResponse.data;
    } catch (parseError) {
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to parse AI service response',
        error: parseError.message
      });
    }

    const nicheSlugs = new Set(niches.map((n) => n.slug));
    const languageCodes = new Set(languages.map((l) => l.code));

    if (inferred.niche_slug && !nicheSlugs.has(inferred.niche_slug)) {
      inferred.niche_slug = null;
    }
    if (inferred.language_code && !languageCodes.has(inferred.language_code)) {
      inferred.language_code = languages[0]?.code || 'en';
    }

    if (!VALID_GENDERS.includes(inferred.template_gender)) {
      inferred.template_gender = 'unisex';
    }
    if (!VALID_WORKFLOW_TYPES.includes(inferred.template_workflow_type)) {
      inferred.template_workflow_type = 'AE_ONLY';
    }
    if (!VALID_CLIPS_TYPES.includes(inferred.template_clips_assets_type)) {
      inferred.template_clips_assets_type = 'non-ai';
    }
    if (!VALID_TEMPLATE_TYPES.includes(inferred.template_type)) {
      inferred.template_type = 'premium';
    }

    if (inferred.template_type === 'free') {
      inferred.credits = 0;
    } else if (!Number.isFinite(inferred.credits) || inferred.credits < 1) {
      inferred.credits = 1;
    }

    if (!Array.isArray(inferred.custom_text_input_fields) || !inferred.custom_text_input_fields.length) {
      inferred.custom_text_input_fields = draftTextFields;
    }

    inferred.custom_text_input_fields = inferred.custom_text_input_fields.map((field, i) => {
      const draft = draftTextFields[i] || draftTextFields.find((d) => d.layer_name === field.layer_name);
      return {
        layer_name: field.layer_name || draft?.layer_name || `Text ${i + 1}`,
        default_text: field.default_text ?? draft?.default_text ?? '',
        input_field_type: field.input_field_type === 'text' ? 'short_text' : (field.input_field_type || 'short_text'),
        user_input_field_name: field.user_input_field_name || field.layer_name || draft?.layer_name || '',
        linked_layer_names: Array.isArray(field.linked_layer_names) ? field.linked_layer_names : []
      };
    });

    if (!inferred.template_name || String(inferred.template_name).trim().length < 5) {
      const fallback =
        bodymovinSummary.composition_name ||
        filenameHint?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') ||
        'New Template';
      inferred.template_name = String(fallback).trim().slice(0, 255);
      if (inferred.template_name.length < 5) {
        inferred.template_name = 'Template Draft';
      }
    }

    if (outputTypeHint && ['image', 'video'].includes(outputTypeHint)) {
      inferred.template_output_type = outputTypeHint;
    } else if (bodymovinSummary.duration_seconds <= 1 || bodymovinSummary.frame_count <= 1) {
      inferred.template_output_type = 'image';
    } else {
      inferred.template_output_type = 'video';
    }

    if (inferred.niche_slug) {
      const nicheRow = (nicheRows || []).find((n) => n.slug === inferred.niche_slug);
      inferred.niche_id = nicheRow?.niche_id ?? null;
    } else {
      inferred.niche_id = null;
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: inferred
    });
  } catch (error) {
    logger.error('Error in inferTemplateMetadata:', { error: error.message, stack: error.stack });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error while inferring template metadata',
      error: error.message
    });
  }
};
