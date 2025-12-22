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
 * For fields that match existing definitions, adds nfd_field_code.
 * For new fields not in definitions, generates field_code, field_label, and field_data_type.
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
 * @apiSuccess {Array} data Enriched input fields with nfd_field_code and new field definitions
 * @apiSuccess {Object} data[].matched_field Field matching information
 * @apiSuccess {String} [data[].matched_field.nfd_field_code] Matched field code (if match found)
 * @apiSuccess {Object} [data[].matched_field.new_field] New field definition (if no match found)
 * @apiSuccess {String} [data[].matched_field.new_field.field_code] Generated field code
 * @apiSuccess {String} [data[].matched_field.new_field.field_label] Generated field label
 * @apiSuccess {String} [data[].matched_field.new_field.field_data_type] Generated field data type
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
 *           "layer_name": "New Field",
 *           "default_text": "New Field",
 *           "input_field_type": "text",
 *           "linked_layer_names": [],
 *           "user_input_field_name": "New field",
 *           "new_field": {
 *             "field_code": "new_field",
 *             "field_label": "New Field",
 *             "field_data_type": "short_text"
 *           }
 *         }
 *       ]
 *     }
 */
exports.matchCustomTextInputFields = async function(req, res) {
  try {
    const { niche_slug, custom_text_input_fields } = req.validatedBody;

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
    
    let fieldDefinitions = await NicheFieldDefinitionModel.getNicheDataFieldDefinitionsByNicheId(nicheId);

    // Step 3: Prepare data for LLM
    const fieldDefinitionsForLLM = fieldDefinitions.map(fd => ({
      field_code: fd.field_code,
      field_label: fd.field_label,
      field_data_type: fd.field_data_type
    }));

    // Step 4: Call LLM to match fields and generate new ones
    const llmProvider = await LLMProviderFactory.createProvider('openai');
    
    const systemMessage = {
      role: 'system',
      content: `You are an expert at SEMANTIC MATCHING of text input fields with existing field definitions.

CORE PRINCIPLE: ALWAYS match to existing fields using SEMANTIC SIMILARITY. Treat synonyms, variations, and related concepts as MATCHES.

Examples of semantic matches (these ARE the same field):
- "family_name" = "family_surname" = "Family's" = "Family Name" (all refer to surname)
- "venue" = "venue_address" = "location" = "address" = "place" (all refer to location)
- "wedding_date" = "event_date" = "ceremony_date" = any date/time string
- "bride_name" = "Bride Name 2" = "bride name" (ignore numbers, match to existing)

Your task:
1. For each input, find the SEMANTICALLY CLOSEST existing field definition. If ANY existing field has similar meaning, USE IT.
2. Return "nfd_field_code" with the existing field's code if a semantic match exists.
3. ONLY create "new_field" if there is absolutely NO existing field with similar meaning.
4. LINK DUPLICATE FIELDS - If multiple input fields match to the same field_code or represent the same data:
   - Find the FIRST occurrence of that field (earliest input_index)
   - For all subsequent occurrences, add the first field's "layer_name" to their "linked_layer_names" array
   - Example: If "Bride Name" (index 2) and "Bride Name 2" (index 3) both match "bride_name", then "Bride Name 2" should have "linked_layer_names": ["Bride Name"]
   - This allows users to enter data once and reuse it for duplicate fields
5. VALIDATE and CORRECT input data if needed:
   - Check "input_field_type" - must be one of: short_text, long_text, date, time, datetime, photo, video. If incorrect, provide corrected value.
   - Check "user_input_field_name" - MUST be a meaningful English description, NOT placeholder text. Rules:
     * NEVER use placeholder patterns like "Xth", "Xxxx", "XX", "20xx", "xxxx" - these are NOT valid
     * NEVER include numbers - remove all numbers (e.g., "Bride name 2" → "bride name", "Groom name 3" → "groom name")
     * If field matches to existing definition, use the field_label or create a descriptive name based on what it represents
     * For date/time fields: use "wedding date", "ceremony time", "event date" etc. (not "Xth xxxx 20xx")
     * For venue/address: use "venue address", "event location", "ceremony venue" etc. (not "Xxxxx xxxxxxxxxx")
     * Should be niche-specific, self-explanatory, lowercase with spaces, in plain English words, NO NUMBERS
     * Examples: "bride name", "groom name", "wedding date", "venue address", "bride father name"
   - If the input data is already correct and meaningful (not placeholder text), do NOT include correction fields (omit them).

RULES FOR NEW FIELDS (only when no match exists):
- Field data types: short_text, long_text, date, time, datetime, photo, video
- Field codes: lowercase with underscores, NO NUMBERS (e.g., "bride_father_name", NOT "father_name_3")
- For family members in wedding context: use "bride_" or "groom_" prefix based on position/context
- Ignore numbers in input (e.g., "Father Name 3" → determine bride/groom side from context)

You must respond with a valid JSON object containing an array called "results".`
    };

    const userMessage = {
      role: 'user',
      content: `Match each input field to the SEMANTICALLY CLOSEST existing field definition.

NICHE CONTEXT: ${niche.niche_name} (slug: ${niche_slug})

EXISTING FIELD DEFINITIONS (use these field_codes when matching):
${JSON.stringify(fieldDefinitionsForLLM, null, 2)}

INPUT FIELDS TO MATCH:
${JSON.stringify(custom_text_input_fields, null, 2)}

MATCHING RULES:
1. USE SEMANTIC SIMILARITY - synonyms and variations ARE matches:
   - "Family Name" / "Family's" → match to "family_surname" if it exists (they mean the same thing)
   - Any address/location/venue text → match to "venue" if it exists
   - Any date/time text → match to "wedding_date" or similar if it exists
   - "Bride Name 2" → match to "bride_name" (ignore numbers)

2. Only create new_field when NO existing field has similar meaning

3. LINK DUPLICATE FIELDS - If multiple fields match the same field_code or represent the same data:
   - Find the FIRST occurrence (lowest input_index) of that field
   - For all subsequent occurrences, add the first field's "layer_name" to "linked_layer_names"
   - Examples:
     * "Bride Name" (index 2) and "Bride Name 2" (index 3) both match "bride_name" → "Bride Name 2" should have "linked_layer_names": ["Bride Name"]
     * "Groom Name" (index 1) and "Groom Name 2" (index 6) both match "groom_name" → "Groom Name 2" should have "linked_layer_names": ["Groom Name"]
     * Two date fields both match "wedding_date" → second one should link to first one's layer_name
   - This allows users to enter data once and reuse it

4. For new fields (when truly no match):
   - NO numbers in codes/labels
   - For parents: use "bride_father_name", "groom_mother_name" etc. based on context/position

5. VALIDATE INPUT DATA - Check and correct if needed (only include if correction is needed):
   - "input_field_type": Must be one of: short_text, long_text, date, time, datetime, photo, video
   - "user_input_field_name": CRITICAL - Must be meaningful English words, NEVER placeholder text or numbers:
     * NEVER use: "Xth", "Xxxx", "XX", "20xx", "xxxx", "Xxxxx" or any placeholder patterns
     * NEVER include numbers - remove ALL numbers (e.g., "Bride name 2" → "bride name", "Groom name 3" → "groom name", "Name 5" → "name")
     * If field matches existing definition: use field_label or descriptive name (e.g., if matches "wedding_date" → use "wedding date")
     * For date/time fields: "wedding date", "ceremony time", "event date" (NOT "Xth xxxx 20xx xxxx am")
     * For venue/address: "venue address", "event location", "ceremony venue" (NOT "Xxxxx xxxxxxxxxx")
     * For names: "bride name", "groom name", "bride father name" (NOT "Smt mother name" - remove honorifics, NOT "name 2" - remove numbers)
     * Should be niche-specific, lowercase with spaces, plain English words that clearly describe the field, NO NUMBERS
     * Examples for "${niche.niche_name}" niche: "bride name", "groom name", "wedding date", "venue address"
   - If input is already meaningful English (not placeholder text) and self-explanatory, omit correction fields

Return JSON:
{
  "results": [
    {
      "input_index": 0,
      "nfd_field_code": "existing_field_code", // USE THIS if semantic match found
      "linked_layer_names": ["First Layer Name"], // Array of layer_names to link to (if this is a duplicate field)
      "corrected_input_field_type": "long_text", // ONLY include if correction needed
      "corrected_user_input_field_name": "bride name" // ONLY include if correction needed
    },
    {
      "input_index": 1,
      "new_field": { // ONLY if no semantic match exists
        "field_code": "new_code",
        "field_label": "New Label", 
        "field_data_type": "short_text"
      },
      "linked_layer_names": ["First Layer Name"] // If this new field is a duplicate of another new field
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
                },
                new_field: {
                  type: 'object',
                  properties: {
                    field_code: {
                      type: 'string',
                      description: 'Generated field code for new field'
                    },
                    field_label: {
                      type: 'string',
                      description: 'Generated field label for new field'
                    },
                    field_data_type: {
                      type: 'string',
                      enum: ['short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video'],
                      description: 'Field data type for new field'
                    }
                  },
                  required: ['field_code', 'field_label', 'field_data_type'],
                  description: 'New field definition if no match found'
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
          // Match found
          enrichedField.nfd_field_code = result.nfd_field_code;
        } else if (result.new_field) {
          // New field generated
          enrichedField.new_field = result.new_field;
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

      return enrichedField;
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: enrichedFields
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

