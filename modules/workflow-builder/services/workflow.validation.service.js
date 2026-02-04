'use strict';

const AiModelRegistryModel = require('../models/ai-model-registry.model');

// In-memory cache for validation rules
const validationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get validation rules for a model (with caching)
 */
exports.getModelValidationRules = async function (modelId) {
  const cacheKey = `validation:${modelId}`;

  // Check cache
  const cached = validationCache.get(cacheKey);
  if (cached && cached.timestamp > Date.now() - CACHE_TTL) {
    return cached.data;
  }

  // Load from database
  const ioDefinitions = await AiModelRegistryModel.getIODefinitionsByModelId(modelId);

  // Stitch socket types (Zero-Join Policy)
  const socketTypeIds = [...new Set(ioDefinitions.map(io => io.amst_id).filter(id => id))];
  const socketTypes = await AiModelRegistryModel.getSocketTypesByIds(socketTypeIds);
  const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st.name]));

  const rules = {};
  for (const io of ioDefinitions) {
    if (io.direction === 'INPUT') {
      const constraints = typeof io.constraints === 'string'
        ? JSON.parse(io.constraints)
        : io.constraints || {};

      rules[io.name] = {
        amiodId: io.amiod_id,
        label: io.label || io.name,
        isRequired: io.is_required,
        socketType: socketTypeMap.get(io.amst_id),
        constraints
      };
    }
  }

  // Cache the result
  validationCache.set(cacheKey, { data: rules, timestamp: Date.now() });

  return rules;
};

/**
 * Validate a single field value
 */
exports.validateField = function (value, rules, fieldName) {
  const errors = [];

  // Required check
  if (rules.isRequired && (value === null || value === undefined || value === '')) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${rules.label || fieldName} is required`
    });
    return errors;
  }

  if (!value) return errors;

  const constraints = rules.constraints || {};

  // String constraints
  if (typeof value === 'string') {
    if (constraints.minLength && value.length < constraints.minLength.value) {
      errors.push({
        field: fieldName,
        code: 'MIN_LENGTH',
        message: constraints.minLength.message || `Minimum ${constraints.minLength.value} characters`
      });
    }

    if (constraints.maxLength && value.length > constraints.maxLength.value) {
      errors.push({
        field: fieldName,
        code: 'MAX_LENGTH',
        message: (constraints.maxLength.message || `Maximum {value} characters`)
          .replace('{value}', constraints.maxLength.value)
          .replace('{actual}', value.length)
      });
    }

    if (constraints.pattern) {
      const regex = new RegExp(constraints.pattern.value);
      if (!regex.test(value)) {
        errors.push({
          field: fieldName,
          code: 'PATTERN',
          message: constraints.pattern.message || 'Invalid format'
        });
      }
    }
  }

  return errors;
};

/**
 * Check if a node input is satisfied by an edge connection (no direct config value needed).
 */
function isInputConnected(nodeId, fieldName, edges) {
  if (!edges || !Array.isArray(edges)) return false;
  return edges.some(
    e => (e.target === nodeId || e.target === String(nodeId)) && e.targetHandle === fieldName
  );
}

/**
 * Validate entire workflow.
 * Required inputs can be satisfied by either: (1) an edge connection, or (2) a direct value (e.g. text, or image upload { bucket, asset_key }).
 */
exports.validateWorkflow = async function (nodes, edges) {
  const allErrors = [];
  const nodeErrors = {};

  for (const node of nodes) {
    if (node.type !== 'AI_MODEL' || !node.amr_id) continue;

    const rules = await this.getModelValidationRules(node.amr_id);
    const configValues = (node.data && node.data.config_values) || node.config_values || {};
    const nodeId = node.uuid || node.id;

    for (const [fieldName, fieldRules] of Object.entries(rules)) {
      const value = configValues[fieldName];

      // Required input satisfied by connection: no config value needed (value comes from connected node at runtime)
      if (fieldRules.isRequired && isInputConnected(nodeId, fieldName, edges)) {
        continue;
      }

      const errors = this.validateField(value, fieldRules, fieldName);
      if (errors.length > 0) {
        allErrors.push(...errors.map(e => ({ ...e, nodeId })));
        if (!nodeErrors[nodeId]) nodeErrors[nodeId] = {};
        nodeErrors[nodeId][fieldName] = errors;
      }
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    nodeErrors
  };
};

/**
 * Clear cache (call when validation rules change)
 */
exports.clearCache = function (modelId = null) {
  if (modelId) {
    validationCache.delete(`validation:${modelId}`);
  } else {
    validationCache.clear();
  }
};
