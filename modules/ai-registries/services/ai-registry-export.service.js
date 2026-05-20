'use strict';

const crypto = require('crypto');
const _ = require('lodash');

const EXPORT_FORMAT = 'photobop-admin-ai-model-registry';
const EXPORT_SCHEMA_VERSION = 1;
const SIGNATURE_ALGORITHM = 'hmac-sha256';

/**
 * Deterministic JSON string for signing (sorted object keys at every depth).
 */
function stableStringify(value) {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const props = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]));
  return '{' + props.join(',') + '}';
}

function getExportSecret(config) {
  return (
    process.env.AI_MODEL_REGISTRY_EXPORT_SECRET ||
    (config && config.jwt && config.jwt.secret) ||
    ''
  );
}

/**
 * Strip server-generated ids and UI-only fields; keep everything needed to recreate the model.
 */
function sanitizeModelForExport(model) {
  const m = _.cloneDeep(model);
  const sourceAmrId = m.amr_id != null ? Number(m.amr_id) : null;

  const exportProviderHint =
    m.provider && typeof m.provider === 'object'
      ? {
          amp_id: m.amp_id,
          name: m.provider.name,
          slug: m.provider.slug
        }
      : null;

  delete m.amr_id;
  delete m.created_at;
  delete m.updated_at;
  delete m.archived_at;
  delete m.provider;

  m.export_provider_hint = exportProviderHint;

  if (Array.isArray(m.io_definitions)) {
    m.io_definitions = m.io_definitions.map((io) => {
      const row = { ...io };
      delete row.amiod_id;
      delete row.amr_id;
      delete row.socket_type;
      delete row.created_at;
      delete row.updated_at;
      return row;
    });
  } else {
    m.io_definitions = [];
  }

  if (Array.isArray(m.tags)) {
    m.tags = m.tags
      .map((t) => (typeof t === 'object' && t != null && t.amtd_id != null ? Number(t.amtd_id) : Number(t)))
      .filter((id) => !Number.isNaN(id));
  } else {
    m.tags = [];
  }

  return { sanitized: m, sourceAmrId };
}

function buildSigningPayload(meta, modelPayload) {
  return {
    format: meta.format,
    schema_version: meta.schema_version,
    exported_at: meta.exported_at,
    source_amr_id: meta.source_amr_id,
    model: modelPayload
  };
}

function signPayload(signingPayload, secret) {
  if (!secret) {
    return '';
  }
  const h = crypto.createHmac('sha256', secret);
  h.update(stableStringify(signingPayload));
  return h.digest('hex');
}

function buildExportDocument(sanitizedModel, sourceAmrId, secret) {
  const exportedAt = new Date().toISOString();
  const meta = {
    format: EXPORT_FORMAT,
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    source_amr_id: sourceAmrId,
    signature_algorithm: SIGNATURE_ALGORITHM
  };

  const signingPayload = buildSigningPayload(
    {
      format: meta.format,
      schema_version: meta.schema_version,
      exported_at: exportedAt,
      source_amr_id: sourceAmrId
    },
    sanitizedModel
  );

  const signature = signPayload(signingPayload, secret);

  return {
    _photobop_ai_model_export: meta,
    signature,
    model: sanitizedModel
  };
}

const REQUIRED_MODEL_KEYS = ['name', 'platform_model_id', 'amp_id'];

function validateImportedModelShape(model) {
  const missing = [];
  for (const key of REQUIRED_MODEL_KEYS) {
    if (model[key] === undefined || model[key] === null || model[key] === '') {
      missing.push(key);
    }
  }
  if (model.parameter_schema === undefined || model.parameter_schema === null) {
    missing.push('parameter_schema');
  }
  if (model.pricing_config === undefined || model.pricing_config === null) {
    missing.push('pricing_config');
  }
  if (model.io_definitions !== undefined && !Array.isArray(model.io_definitions)) {
    missing.push('io_definitions (must be an array if present)');
  }
  return missing;
}

/**
 * Verify export file and return parsed model payload or { error, statusCode }.
 */
function verifyImportEnvelope(body, secret) {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON body.', statusCode: 400 };
  }

  const meta = body._photobop_ai_model_export;
  if (!meta || typeof meta !== 'object') {
    return { error: 'Missing _photobop_ai_model_export metadata. This file was not produced by Tellow AI Admin export.', statusCode: 400 };
  }

  if (meta.format !== EXPORT_FORMAT) {
    return { error: 'Unrecognized export format.', statusCode: 400 };
  }

  if (Number(meta.schema_version) !== EXPORT_SCHEMA_VERSION) {
    return {
      error: `Unsupported schema_version ${meta.schema_version}. Expected ${EXPORT_SCHEMA_VERSION}.`,
      statusCode: 400
    };
  }

  if (!meta.exported_at || typeof meta.exported_at !== 'string') {
    return { error: 'Invalid export: exported_at is required.', statusCode: 400 };
  }

  const model = body.model;
  if (!model || typeof model !== 'object') {
    return { error: 'Invalid export: model object is missing.', statusCode: 400 };
  }

  if (!secret) {
    return {
      error:
        'Import signing is not configured (set AI_MODEL_REGISTRY_EXPORT_SECRET or jwt.secret). Cannot verify this file.',
      statusCode: 503
    };
  }

  const signingPayload = buildSigningPayload(
    {
      format: meta.format,
      schema_version: Number(meta.schema_version),
      exported_at: meta.exported_at,
      source_amr_id: meta.source_amr_id != null ? Number(meta.source_amr_id) : null
    },
    model
  );

  const expected = signPayload(signingPayload, secret);
  const provided = typeof body.signature === 'string' ? body.signature.trim() : '';

  if (!provided || provided !== expected) {
    return {
      error: 'Signature verification failed. File may be tampered with or exported from a different environment secret.',
      statusCode: 403
    };
  }

  const missing = validateImportedModelShape(model);
  if (missing.length) {
    return { error: `Missing or invalid fields: ${missing.join(', ')}`, statusCode: 400 };
  }

  return {
    model,
    source_amr_id: meta.source_amr_id != null && meta.source_amr_id !== '' ? Number(meta.source_amr_id) : null
  };
}

/**
 * Prepare payload for aiRegistryModel.createAiModel + IO + tags (fallback cleared).
 */
function modelPayloadForInsert(importedModel) {
  const m = _.cloneDeep(importedModel);
  delete m.export_provider_hint;

  const insertPayload = {
    amp_id: Number(m.amp_id),
    name: m.name,
    platform_model_id: m.platform_model_id,
    version: m.version || '1.0.0',
    description: m.description != null ? m.description : null,
    status: m.status || 'draft',
    circuit_state: m.circuit_state || 'CLOSED',
    fallback_amr_id: null,
    fallback_mapping: m.fallback_mapping != null ? m.fallback_mapping : null,
    parameter_schema: m.parameter_schema || {},
    workflow_selection_schema: m.workflow_selection_schema ?? null,
    data_contract: m.data_contract ?? null,
    pricing_config: m.pricing_config || {},
    icon_url: m.icon_url != null ? m.icon_url : null,
    documentation_url: m.documentation_url != null ? m.documentation_url : null
  };

  const ioDefinitions = Array.isArray(m.io_definitions) ? m.io_definitions : [];
  const tagIds = Array.isArray(m.tags) ? m.tags.map((id) => Number(id)).filter((id) => !Number.isNaN(id)) : [];

  return { insertPayload, ioDefinitions, tagIds };
}

module.exports = {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  stableStringify,
  sanitizeModelForExport,
  buildExportDocument,
  verifyImportEnvelope,
  modelPayloadForInsert,
  getExportSecret
};
