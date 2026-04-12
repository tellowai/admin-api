'use strict';

const NicheModel = require('../models/niche.model');
const NicheFieldDefinitionModel = require('../models/niche.data.field.definition.model');
const RedisNicheModel = require('../dbo/redis.niche.model');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');

/**
 * Match custom text input fields with niche field definitions using LLM
 * @api {post} /niches/match-fields Match custom text input fields with niche field definitions
 * @apiVersion 1.0.0
 * @apiName MatchCustomTextInputFields
 * @apiGroup Niches
 * @apiPermission JWT
 *
 * @apiDescription Matches custom text input fields with existing niche field definitions using AI.
 * Only existing niche field definitions are used: sets nfd_field_code when a semantic match exists.
 * If no definition fits, the field is left without nfd_field_code (admins must create definitions in the niche first).
 * When nfd_field_code is set, user_input_field_name and input_field_type are overwritten from the DB definition
 * (field_label, field_data_type) so labels and types stay consistent with the niche catalog.
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String} niche_slug Niche slug (e.g., 'wedding')
 * @apiBody {Array} custom_text_input_fields Array of custom text input field objects
 * @apiBody {String} custom_text_input_fields[].layer_name Layer name
 * @apiBody {String} custom_text_input_fields[].default_text Default text
 * @apiBody {String} custom_text_input_fields[].input_field_type Field type (short_text, long_text, date, time, datetime, photo, video)
 * @apiBody {Array} [custom_text_input_fields[].linked_layer_names] Linked layer names
 * @apiBody {String} custom_text_input_fields[].user_input_field_name User input field name
 *
 * @apiSuccess {Array} data Enriched input fields with nfd_field_code when matched
 * @apiSuccess {String} [data[].nfd_field_code] Matched field code (if match found)
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "data": [
 *         {
 *           "layer_name": "Bride Name",
 *           "default_text": "Bride Name",
 *           "input_field_type": "text",
 *           "linked_layer_names": [],
 *           "user_input_field_name": "Bride name",
 *           "nfd_field_code": "bride_name"
 *         },
 *         {
 *           "layer_name": "Unknown layer",
 *           "default_text": "",
 *           "input_field_type": "text",
 *           "linked_layer_names": [],
 *           "user_input_field_name": "unknown"
 *         }
 *       ]
 *     }
 */
exports.matchCustomTextInputFields = async function(req, res) {
  try {
    const { niche_slug, custom_text_input_fields: rawFields } = req.validatedBody;
    // Normalize 'text' to 'short_text' (UI may send INPUT_FIELD_TYPES.TEXT)
    const custom_text_input_fields = Array.isArray(rawFields)
      ? rawFields.map(f => ({
          ...f,
          input_field_type: f.input_field_type === 'text' ? 'short_text' : f.input_field_type
        }))
      : rawFields;

    // Step 1: Get niche by slug from MySQL
    // TODO: Enable Redis caching later
    // let niche = await RedisNicheModel.getNicheBySlug(niche_slug);
    // if (!niche) {
    //   niche = await NicheModel.getNicheBySlug(niche_slug);
    //   if (niche) {
    //     await RedisNicheModel.setNicheBySlug(niche_slug, niche);
    //   }
    // }
    
    let niche = await NicheModel.getNicheBySlug(niche_slug);
    
    if (!niche) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: `Niche with slug '${niche_slug}' not found`
      });
    }

    const nicheId = niche.niche_id;

    // Step 2: Get field definitions for niche from MySQL
    // TODO: Enable Redis caching later
    // let fieldDefinitions = await RedisNicheModel.getFieldDefinitionsByNicheId(nicheId);
    // if (!fieldDefinitions) {
    //   fieldDefinitions = await NicheFieldDefinitionModel.getNicheDataFieldDefinitionsByNicheId(nicheId);
    //   await RedisNicheModel.setFieldDefinitionsByNicheId(nicheId, fieldDefinitions);
    // }
    
    // getNicheDataFieldDefinitionsByNicheId already returns only non-archived (archived_at IS NULL)
    let fieldDefinitions = await NicheFieldDefinitionModel.getNicheDataFieldDefinitionsByNicheId(nicheId);
    const activeFieldDefinitions = fieldDefinitions.filter(fd => fd != null);

    // Step 3: Prepare data for LLM (only active definitions — do not send archived fields)
    const fieldDefinitionsForLLM = activeFieldDefinitions.map(fd => ({
      field_code: fd.field_code,
      field_label: fd.field_label,
      field_data_type: fd.field_data_type
    }));

    // Step 4: Call LLM to match fields to existing definitions only (no new_field generation)
    const llmProvider = await LLMProviderFactory.createProvider('openai');
    
    const systemMessage = {
      role: 'system',
      content: `You are an expert at SEMANTIC MATCHING of text input fields to EXISTING niche field definitions only.

CRITICAL: You MUST NOT invent new niche fields. Never output "new_field". If no existing definition fits, omit "nfd_field_code" for that input. Admins create missing definitions elsewhere; you only map to what already exists.

CORE PRINCIPLE: Match using SEMANTIC SIMILARITY. Treat synonyms, variations, and related concepts as matches when they align with an existing field_code.

Examples of semantic matches (these ARE the same field):
- "family_name" = "family_surname" = "Family's" = "Family Name" (all refer to surname)
- "venue" = "venue_address" = "location" = "address" = "place" (all refer to location)
- "wedding_date" = "event_date" = "ceremony_date" = any date/time string
- "bride_name" = "Bride Name 2" = "bride name" (ignore numbers, match to existing)

Your task:
1. For each input, find the SEMANTICALLY CLOSEST existing field definition from the list provided. If a match exists, set "nfd_field_code" to that field's code.
2. If NO existing definition is a reasonable semantic fit, do NOT set "nfd_field_code" (leave it unset). Do NOT propose or create new field definitions.
3. LINK DUPLICATE FIELDS - If multiple input fields match the same field_code or represent the same data:
   - Find the FIRST occurrence (earliest input_index)
   - For subsequent occurrences, add the first field's "layer_name" to their "linked_layer_names" array
   - Example: "Bride Name" (index 2) and "Bride Name 2" (index 3) both match "bride_name" → index 3 has "linked_layer_names": ["Bride Name"]
4. VALIDATE and CORRECT input data if needed:
   - "input_field_type" must be one of: short_text, long_text, date, time, datetime, photo, video. If incorrect, use corrected_input_field_type.
   - "user_input_field_name": meaningful English; no placeholder patterns; remove stray numbers when matching to a label.
   - If input is already correct, omit correction fields.

You must respond with a valid JSON object containing an array called "results".`
    };

    const userMessage = {
      role: 'user',
      content: `Match each input field to the SEMANTICALLY CLOSEST EXISTING field definition below. Do not invent new field definitions.

NICHE CONTEXT: ${niche.niche_name} (slug: ${niche_slug})

EXISTING FIELD DEFINITIONS (ONLY these field_codes may be used for nfd_field_code):
${JSON.stringify(fieldDefinitionsForLLM, null, 2)}

INPUT FIELDS TO MATCH:
${JSON.stringify(custom_text_input_fields, null, 2)}

MATCHING RULES:
1. USE SEMANTIC SIMILARITY. If no definition fits, omit "nfd_field_code" for that input_index (do not output new_field).
2. LINK DUPLICATE FIELDS when multiple inputs match the same field_code:
   - First occurrence: set nfd_field_code only (no extra links).
   - Later occurrences: set nfd_field_code and linked_layer_names to include the first field's layer_name.
3. VALIDATE INPUT (only include corrections when needed): corrected_input_field_type, corrected_user_input_field_name.

Return JSON:
{
  "results": [
    {
      "input_index": 0,
      "nfd_field_code": "existing_code_or_omit_if_no_match",
      "linked_layer_names": ["First Layer Name"],
      "corrected_input_field_type": "long_text",
      "corrected_user_input_field_name": "bride name"
    }
  ]
}`
    };

    // Define response format schema
    const responseFormat = {
      schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                input_index: {
                  type: 'number',
                  description: 'Index of the input field in the original array'
                },
                nfd_field_code: {
                  type: 'string',
                  description: 'Field code from existing definitions if match found'
                },
                corrected_input_field_type: {
                  type: 'string',
                  enum: ['short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video'],
                  description: 'Corrected input_field_type if the original was incorrect. Omit if original is correct.'
                },
                corrected_user_input_field_name: {
                  type: 'string',
                  description: 'Corrected user_input_field_name if the original was incorrect. Omit if original is correct.'
                },
                linked_layer_names: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of layer_names that this field should link to (if this is a duplicate of another field). Include the layer_name of the first occurrence of the same field. Omit if this is the first occurrence or not a duplicate.'
                }
              },
              required: ['input_index'],
              description: 'Matching result for each input field'
            }
          }
        },
        required: ['results']
      },
      schemaName: 'FieldMatchingResult'
    };

    // Call LLM
    const llmResponse = await llmProvider.createChatCompletion({
      messages: [systemMessage, userMessage],
      responseFormat: responseFormat
    });

    if (!llmResponse.success) {
      logger.error('LLM matching failed:', { error: llmResponse.error, niche_slug });
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to match fields using AI service',
        error: llmResponse.error
      });
    }

    // Step 5: Process LLM response and enrich input fields
    let llmResults;
    try {
      llmResults = typeof llmResponse.data === 'string' 
        ? JSON.parse(llmResponse.data) 
        : llmResponse.data;
      
      // Validate response structure
      if (!llmResults || !llmResults.results || !Array.isArray(llmResults.results)) {
        throw new Error('Invalid LLM response structure: missing results array');
      }
    } catch (parseError) {
      logger.error('Failed to parse LLM response:', { 
        error: parseError.message, 
        data: llmResponse.data 
      });
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to parse AI service response',
        error: parseError.message
      });
    }

    // Create a map of results by input_index
    const resultsMap = {};
    llmResults.results.forEach(result => {
      if (result.input_index !== undefined && result.input_index !== null) {
        resultsMap[result.input_index] = result;
      }
    });

    // Enrich input fields with matching results
    const enrichedFields = custom_text_input_fields.map((field, index) => {
      const result = resultsMap[index];
      const enrichedField = { ...field };

      if (result) {
        if (result.nfd_field_code) {
          enrichedField.nfd_field_code = result.nfd_field_code;
        }

        // Apply corrections if provided
        if (result.corrected_input_field_type) {
          enrichedField.input_field_type = result.corrected_input_field_type;
        }
        if (result.corrected_user_input_field_name) {
          enrichedField.user_input_field_name = result.corrected_user_input_field_name;
        }

        // Apply linked_layer_names if provided
        if (result.linked_layer_names && Array.isArray(result.linked_layer_names) && result.linked_layer_names.length > 0) {
          // Merge with existing linked_layer_names, avoiding duplicates
          const existingLinked = enrichedField.linked_layer_names || [];
          enrichedField.linked_layer_names = [...new Set([...existingLinked, ...result.linked_layer_names])];
        }
      }

      // Never return AI-generated new_field; niche definitions must be created manually in admin
      delete enrichedField.new_field;

      return enrichedField;
    });

    // Source of truth: when matched to a niche definition, use DB field_label + field_data_type (not LLM / layer text)
    const fieldCodeToDefinition = new Map(
      activeFieldDefinitions.map((fd) => [fd.field_code, fd])
    );
    const standardizedFields = enrichedFields.map((field) => {
      const code = field.nfd_field_code;
      if (!code) {
        return field;
      }
      const def = fieldCodeToDefinition.get(code);
      if (!def) {
        return field;
      }
      const label = def.field_label != null ? String(def.field_label).trim() : '';
      return {
        ...field,
        user_input_field_name: label || field.user_input_field_name,
        input_field_type: def.field_data_type || field.input_field_type
      };
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: standardizedFields
    });

  } catch (error) {
    logger.error('Error in matchCustomTextInputFields:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error while matching fields',
      error: error.message
    });
  }
};

