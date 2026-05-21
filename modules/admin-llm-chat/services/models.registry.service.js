'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../../config/config');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const DEFAULT_MODELS_PATH = path.join(__dirname, '../constants/models.json');

const PROVIDERS = ['openai', 'anthropic'];

/** Retired registry / DB ids → current Anthropic API model id */
const LEGACY_MODEL_ALIASES = {
  'claude-sonnet-4-20250514': { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
};

let cached = null;
let cachedPath = null;
let cachedMtimeMs = null;

function resolveModelsPath() {
  const fromEnv = process.env.ADMIN_LLM_CHAT_MODELS_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  if (config.adminLlmChat?.modelsPath) return path.resolve(config.adminLlmChat.modelsPath);
  return DEFAULT_MODELS_PATH;
}

function readRawConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { models: parsed, providerDefaults: {}, defaultModel: null };
  }
  return {
    models: parsed.models || [],
    providerDefaults: parsed.providerDefaults || {},
    defaultModel: parsed.defaultModel || null,
    summarizer: parsed.summarizer || null,
  };
}

function platformModelId(entry) {
  return entry.id || entry.modelId || entry.platformModelId || entry.model_id || null;
}

function normalizeEntry(entry, providerDefaults) {
  if (!entry || typeof entry !== 'object') return null;

  const provider = String(entry.provider || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) return null;

  const id = platformModelId(entry);
  if (!id) return null;

  const defaults = { ...(providerDefaults[provider] || {}), ...entry };

  const normalized = {
    id,
    provider,
    displayName: entry.displayName || entry.display_name || entry.name || id,
    contextWindow: entry.contextWindow ?? defaults.contextWindow ?? 128000,
    maxOutputTokens: entry.maxOutputTokens ?? defaults.maxOutputTokens ?? 8192,
    supportsVision: entry.supportsVision ?? defaults.supportsVision ?? true,
    supportsTools: entry.supportsTools ?? defaults.supportsTools ?? true,
    inputCostPer1M: entry.inputCostPer1M ?? defaults.inputCostPer1M ?? 0,
    outputCostPer1M: entry.outputCostPer1M ?? defaults.outputCostPer1M ?? 0,
  };

  if (provider === 'anthropic') {
    normalized.cacheReadPer1M = entry.cacheReadPer1M ?? defaults.cacheReadPer1M ?? 0;
    normalized.cacheWritePer1M = entry.cacheWritePer1M ?? defaults.cacheWritePer1M ?? 0;
  }

  return normalized;
}

function loadConfig(force = false) {
  const filePath = resolveModelsPath();
  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch (err) {
    throw new Error(`admin_llm_chat models config not found: ${filePath} (${err.message})`);
  }

  if (!force && cached && cachedPath === filePath && cachedMtimeMs === mtimeMs) {
    return cached;
  }

  const raw = readRawConfig(filePath);
  const seen = new Set();
  const models = [];

  raw.models.forEach((entry) => {
    const normalized = normalizeEntry(entry, raw.providerDefaults);
    if (!normalized) return;
    const key = `${normalized.provider}:${normalized.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    models.push(normalized);
  });

  cached = {
    filePath,
    models,
    defaultModel: raw.defaultModel,
    summarizer: raw.summarizer,
  };
  cachedPath = filePath;
  cachedMtimeMs = mtimeMs;
  return cached;
}

function isProviderEnabled(provider) {
  if (provider === 'openai') return CONSTANTS.PROVIDER_OPENAI_ENABLED;
  if (provider === 'anthropic') return CONSTANTS.PROVIDER_ANTHROPIC_ENABLED;
  return false;
}

function getAllModels() {
  return loadConfig().models;
}

function getEnabledModels() {
  return getAllModels().filter((m) => isProviderEnabled(m.provider));
}

function withDefaultFlag(models) {
  const def = getDefaultModel();
  if (!def) return models.map((m) => ({ ...m, default: false }));
  return models.map((m) => ({
    ...m,
    default: m.id === def.id && m.provider === def.provider,
  }));
}

function getEnabledModelsForClient() {
  return withDefaultFlag(getEnabledModels());
}

function resolveLegacyAlias(modelId, provider) {
  const alias = LEGACY_MODEL_ALIASES[modelId];
  if (!alias) return null;
  const p = provider ? String(provider).toLowerCase() : null;
  if (p && alias.provider !== p) return null;
  return getAllModels().find((m) => m.id === alias.modelId && m.provider === alias.provider) || null;
}

function findModel(modelId, provider) {
  if (!modelId) return null;
  const p = provider ? String(provider).toLowerCase() : null;
  return getAllModels().find((m) => m.id === modelId && (!p || m.provider === p)) || null
    || resolveLegacyAlias(modelId, provider);
}

function resolveModel(modelId, provider) {
  const found = findModel(modelId, provider);
  if (found && isProviderEnabled(found.provider)) return found;
  return getDefaultModel();
}

function getSummarizerModel() {
  const { summarizer } = loadConfig();
  if (summarizer?.modelId && summarizer?.provider) {
    const found = findModel(summarizer.modelId, summarizer.provider);
    if (found && isProviderEnabled(found.provider)) return found;
  }
  const enabled = getEnabledModels();
  const cheap = enabled.find((m) => m.id.includes('mini') || m.id.includes('haiku'))
    || enabled[0];
  return cheap || null;
}

function getDefaultModel() {
  const { defaultModel } = loadConfig();
  const spec = defaultModel || CONSTANTS.DEFAULT_MODEL;
  const modelId = spec.modelId || spec.id;
  const provider = spec.provider;

  const found = findModel(modelId, provider);
  if (found && isProviderEnabled(found.provider)) return found;

  const enabled = getEnabledModels();
  if (enabled.length) return enabled[0];

  return null;
}

function invalidateCache() {
  cached = null;
  cachedPath = null;
  cachedMtimeMs = null;
}

module.exports = {
  resolveModelsPath,
  getAllModels,
  getEnabledModels,
  getEnabledModelsForClient,
  withDefaultFlag,
  findModel,
  resolveModel,
  getDefaultModel,
  getSummarizerModel,
  invalidateCache,
  normalizeEntry,
};
