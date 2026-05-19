'use strict';

const NicheModel = require('../../niches/models/niche.model');
const LanguageModel = require('../../languages/models/language.model');
const TemplateFacetModel = require('../models/template.facet.model');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const {
  extractCustomTextInputFieldsFromBodymovin,
  summarizeBodymovinForLlm
} = require('../utils/bodymovinTextLayers.utils');
const {
  resolveTemplateTags,
  buildTemplateTagLabels,
  enrichFacetsCatalogForLlm
} = require('../utils/templateTagInference.utils');

const VALID_GENDERS = ['male', 'female', 'couple', 'unisex'];
const VALID_WORKFLOW_TYPES = ['AI_ONLY', 'AI_PLUS_AE', 'AE_ONLY'];
const VALID_CLIPS_TYPES = ['ai', 'non-ai'];
const VALID_TEMPLATE_TYPES = ['free', 'premium', 'standard', 'exclusive', 'ai'];

const GENERIC_NAME_PATTERNS = [
  /^first\s+birthday\s+template/i,
  /^birthday\s+template$/i,
  /^wedding\s+template$/i,
  /^new\s+template$/i,
  /^template\s+draft$/i,
  /^birthday\s+invitation\s+template/i
];

function buildMetadataResponseFormat() {
  return {
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
        },
        template_tag_ids: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              facet_id: { type: 'number' },
              ttd_id: { type: 'number' }
            },
            required: ['facet_id', 'ttd_id']
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
        'custom_text_input_fields',
        'template_tag_ids'
      ]
    },
    schemaName: 'TemplateMetadataInference'
  };
}

function buildSystemPrompt(hasThumbImage) {
  const visionBlock = hasThumbImage
    ? `
VISION (PRIMARY for niche_slug and template_name):
- You are given a preview image of the rendered template. Study it carefully: visible text, language/script, colors, motifs (floral, royal, cartoon, minimal), occasion cues, gender cues, cultural style.
- niche_slug: decide mainly from what you SEE in the image (birthday party decor → birthday, wedding attire/mandap → wedding, etc.). JSON text layers are secondary.
- template_name: describe THIS specific design in one short English line (5–80 chars). Mention distinctive visuals (e.g. "Peacock Border Gold First Birthday", "Minimal Pink Floral Girl Birthday", "Rustic Couple Wedding Save the Date").`
    : `
- niche_slug: infer from JSON text layers and composition name when no image is provided.`;

  return `You infer admin template metadata from After Effects / Bodymovin (Lottie) export context.
${visionBlock}

template_name RULES (critical):
- One simple English line. Unique to THIS design — never reuse generic titles across templates.
- FORBIDDEN vague names: "First Birthday Template", "Wedding Template", "Birthday Invitation", "Template Draft", or only occasion + "Template".
- DO use visible style cues: colors, borders, characters, florals, cultural motifs, layout (e.g. "Royal Blue Peacock Kids Birthday", "Pastel Balloon Garland Boy Birthday").
- Read on-screen placeholder text in the image when present; reflect theme but prioritize visual style over copying placeholder names verbatim.

Other fields:
- template_gender: male | female | couple | unisex — from image + text layers.
- template_workflow_type: AE_ONLY for motion templates with user slots; AI_PLUS_AE / AI_ONLY only when clearly AI-generation-first.
- template_clips_assets_type: non-ai for AE-only; ai when AI clips needed.
- template_type: free | premium | standard | exclusive | ai — default premium for celebration cards.
- niche_slug: MUST be one of the provided niche slugs, or null.
- language_code: MUST be one of the provided language codes from visible script + JSON.
- credits: 0 if template_type is free, else 1–5.
- is_effects: true only for short effect overlays, not full greeting cards.
- Refine custom_text_input_fields: same count; correct input_field_type and user_input_field_name.

template_tag_ids (from database catalog in user message):
- Pick tags ONLY from AVAILABLE TEMPLATE TAG FACETS — use exact facet_id and ttd_id integers.
- For each facet with cardinality "single", pick at most one tag; for "multi", pick specific tags that clearly apply.
- Tags with applies_to_all: true (e.g. "All", "Generic", "Any") mean the template fits every value in that facet — use ONLY when the design is truly broad/not occasion-specific. Do not mix applies_to_all with specific tags in the same facet.
- When you pick an applies_to_all tag on a multi facet, the system will auto-select all specific tags in that facet.
- Prefer tags for facets marked required_for_publish when the template matches.
- Use preview image + JSON for occasion, style, age band, gender presentation, language/script, etc.
- Return [] only if nothing fits; otherwise assign the best-matching tags per facet.

Respond with JSON only matching the schema.`;
}

function buildUserText({
  outputTypeHint,
  filenameHint,
  niches,
  languages,
  facetsCatalog,
  bodymovinSummary,
  draftTextFields,
  hasThumbImage
}) {
  return `Infer template metadata.
${hasThumbImage ? 'The attached image is the template preview/thumbnail — use it as the main source for niche_slug, template_name, and template_tag_ids.\n' : ''}
OUTPUT TYPE HINT: ${outputTypeHint || 'unknown'}
FILENAME HINT: ${filenameHint || 'none'}

AVAILABLE NICHES (slug → name):
${JSON.stringify(niches, null, 2)}

AVAILABLE LANGUAGES (code → name):
${JSON.stringify(languages, null, 2)}

AVAILABLE TEMPLATE TAG FACETS (pick template_tag_ids only from these facet_id + ttd_id pairs):
${JSON.stringify(facetsCatalog, null, 2)}

BODYMOVIN SUMMARY (secondary for niche/name when image present):
${JSON.stringify(bodymovinSummary, null, 2)}

DRAFT TEXT FIELDS (refine types and user_input_field_name):
${JSON.stringify(draftTextFields, null, 2)}`;
}

function sanitizeTemplateName(name, bodymovinSummary) {
  let cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (cleaned.length < 5) return null;
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 80).trim();
  }
  const isGeneric = GENERIC_NAME_PATTERNS.some((re) => re.test(cleaned));
  if (isGeneric && bodymovinSummary?.text_layers?.length) {
    const hints = bodymovinSummary.text_layers
      .slice(0, 2)
      .map((t) => t.default_text || t.layer_name)
      .filter(Boolean)
      .join(' ');
    if (hints) {
      cleaned = `${cleaned.replace(/\s*template\s*$/i, '').trim()} ${hints}`.trim().slice(0, 80);
    }
  }
  return cleaned.length >= 5 ? cleaned : null;
}

/**
 * @api {post} /templates/infer-metadata Infer template general metadata from Bodymovin JSON (LLM)
 * @apiPermission JWT
 */
exports.inferTemplateMetadata = async function (req, res) {
  try {
    const {
      bodymovin_json: bodymovinJson,
      template_output_type: outputTypeHint,
      filename_hint: filenameHint,
      thumb_image_data_url: thumbImageDataUrl
    } = req.validatedBody;

    const hasThumbImage =
      typeof thumbImageDataUrl === 'string' &&
      thumbImageDataUrl.startsWith('data:image/') &&
      thumbImageDataUrl.includes('base64,');

    const [nicheRows, languageRows, facetsWithTags] = await Promise.all([
      NicheModel.listNiches({ limit: 100, offset: 0 }),
      LanguageModel.listLanguages({ limit: 200, offset: 0 }),
      TemplateFacetModel.listAllTemplateFacetsWithTags()
    ]);

    const facetsCatalog = enrichFacetsCatalogForLlm(facetsWithTags);

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
    if (typeof llmProvider.initialize === 'function') {
      await llmProvider.initialize();
    }
    const responseFormat = buildMetadataResponseFormat();
    const systemMessage = { role: 'system', content: buildSystemPrompt(hasThumbImage) };
    const userText = buildUserText({
      outputTypeHint,
      filenameHint,
      niches,
      languages,
      facetsCatalog,
      bodymovinSummary,
      draftTextFields,
      hasThumbImage
    });

    let llmResponse;
    if (hasThumbImage) {
      llmResponse = await llmProvider.createMultiModalCompletion({
        messages: [systemMessage, { role: 'user', content: userText }],
        images: [{ url: thumbImageDataUrl, detail: 'high' }],
        responseFormat
      });
    } else {
      llmResponse = await llmProvider.createChatCompletion({
        messages: [systemMessage, { role: 'user', content: userText }],
        responseFormat
      });
    }

    if (!llmResponse.success) {
      logger.error('Template metadata LLM inference failed:', { error: llmResponse.error, hasThumbImage });
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

    const sanitizedName = sanitizeTemplateName(inferred.template_name, bodymovinSummary);
    if (sanitizedName) {
      inferred.template_name = sanitizedName;
    } else {
      const fallback =
        bodymovinSummary.composition_name ||
        filenameHint?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() ||
        'Styled Celebration Card';
      inferred.template_name = String(fallback).slice(0, 80);
      if (inferred.template_name.length < 5) {
        inferred.template_name = 'Styled Celebration Card';
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

    inferred.template_tag_ids = resolveTemplateTags(inferred, facetsWithTags);
    inferred.template_tag_labels = buildTemplateTagLabels(
      inferred.template_tag_ids,
      facetsWithTags
    );

    if (!inferred.template_tag_ids.length) {
      logger.warn('Template metadata inference produced no tags', {
        niche_slug: inferred.niche_slug,
        facet_count: facetsCatalog.length
      });
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
