'use strict';

const aiRegistryModel = require('../models/ai-registry.model');
const paginationController = require('../../core/controllers/pagination.controller');
const StorageFactory = require('../../os2/providers/storage.factory');
const _ = require('lodash');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');

/**
 * List AI Models
 */
exports.list = async function (req, res) {
  try {
    const paginationParams = paginationController.getPaginationParams(req.query);
    const searchParams = {
      search: req.query.search,
      amp_id: req.query.amp_id,
      status: req.query.status
    };

    const models = await aiRegistryModel.listAiModels(searchParams, paginationParams);

    // Stitch Providers
    const ampIds = _.uniq(models.map(m => m.amp_id));
    const providers = await aiRegistryModel.getProvidersByIds(ampIds);

    // Batch generate presigned URLs for logos
    // Filter distinct logo keys to avoid redundant S3 calls
    const distinctLogos = _.uniqBy(
      providers.filter(p => p.provider_logo_key && p.provider_logo_bucket),
      p => `${p.provider_logo_bucket}/${p.provider_logo_key}`
    );

    const urlMap = {};
    if (distinctLogos.length > 0) {
      const storageProvider = StorageFactory.getProvider();
      await Promise.all(distinctLogos.map(async (p) => {
        try {
          const url = await storageProvider.generatePresignedDownloadUrlFromBucket(p.provider_logo_bucket, p.provider_logo_key);
          urlMap[`${p.provider_logo_bucket}/${p.provider_logo_key}`] = url;
        } catch (e) {
          console.error(`Failed to sign url for ${p.provider_logo_key}:`, e);
        }
      }));
    }

    const providersMap = _.keyBy(providers.map(p => {
      let logoUrl = null;
      if (p.provider_logo_key && p.provider_logo_bucket) {
        logoUrl = urlMap[`${p.provider_logo_bucket}/${p.provider_logo_key}`] || null;
      }

      // Remove raw S3 keys from response
      const { provider_logo_key, provider_logo_bucket, ...rest } = p;
      return {
        ...rest,
        logo_url: logoUrl
      };
    }), 'amp_id');

    const result = models.map(model => {
      // Ensure pricing_config is returned as a proper JSON object, not a string
      let parsedPricingConfig = model.pricing_config;
      if (typeof parsedPricingConfig === 'string') {
        try { parsedPricingConfig = JSON.parse(parsedPricingConfig); } catch (e) { /* keep as-is */ }
      }

      let parsedParameterSchema = model.parameter_schema;
      if (typeof parsedParameterSchema === 'string') {
        try { parsedParameterSchema = JSON.parse(parsedParameterSchema); } catch (e) { /* keep as-is */ }
      }

      return {
        ...model,
        pricing_config: parsedPricingConfig,
        parameter_schema: parsedParameterSchema,
        provider: providersMap[model.amp_id] || null
      };
    });

    return res.status(HTTP_STATUS_CODES.OK).json(result);
  } catch (err) {
    console.error('Error listing AI models:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || 'Internal Server Error' });
  }
};

/**
 * Create AI Model
 */
exports.create = async function (req, res) {
  try {
    // Basic validation
    if (!req.body.name || !req.body.platform_model_id || !req.body.amp_id) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).send({ message: req.t('ai_model:VALIDATION_REQUIRED') || 'Name, platform_model_id, and provider (amp_id) are required.' });
    }

    const newModelData = {
      amp_id: req.body.amp_id,
      name: req.body.name,
      platform_model_id: req.body.platform_model_id,
      version: req.body.version || 'v1.0.0',
      description: req.body.description,
      status: req.body.status || 'active',
      parameter_schema: req.body.parameter_schema || {},
      pricing_config: req.body.pricing_config || {},
      icon_url: req.body.icon_url,
      documentation_url: req.body.documentation_url
    };

    const result = await aiRegistryModel.createAiModel(newModelData);
    const amrId = result.insertId;

    if (req.body.tags !== undefined) {
      const amtdIds = Array.isArray(req.body.tags)
        ? req.body.tags.map(t => (typeof t === 'object' && t != null && t.amtd_id != null) ? t.amtd_id : t).filter(Boolean)
        : [];
      await aiRegistryModel.setTagsForAmrId(amrId, amtdIds);
    }

    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY',
      actionName: 'CREATE_AI_REGISTRY_MODEL',
      entityId: amrId
    });
    return res.status(HTTP_STATUS_CODES.CREATED).json({ amr_id: amrId, ...newModelData });
  } catch (err) {
    console.error('Error creating AI model:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: err.message || req.t('common:SOMETHING_WENT_WRONG') });
  }
};

/**
 * Get AI Model by ID (Full Detail)
 */
exports.read = async function (req, res) {
  try {
    const amrId = req.params.amrId;
    const model = await aiRegistryModel.getAiModelById(amrId);

    if (!model) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).send({ message: req.t('ai_model:AI_MODEL_NOT_FOUND') || 'AI Model not found' });
    }

    // Fetch related data in parallel (tags optional - table may not exist yet)
    const [providers, ioDefinitions, tagsResult] = await Promise.all([
      aiRegistryModel.getProvidersByIds([model.amp_id]),
      aiRegistryModel.getIoDefinitionsByModelId(amrId),
      aiRegistryModel.getTagsForAmrId(amrId).catch(() => [])
    ]);

    model.provider = providers[0] || null;
    model.tags = tagsResult || [];

    // Stitch Socket Types to IO Definitions
    if (ioDefinitions.length > 0) {
      const amstIds = _.uniq(ioDefinitions.map(io => io.amst_id));
      const socketTypes = await aiRegistryModel.getSocketTypesByIds(amstIds);
      const socketTypesMap = _.keyBy(socketTypes, 'amst_id');

      model.io_definitions = ioDefinitions.map(io => {
        const row = { ...io, socket_type: socketTypesMap[io.amst_id] || null };
        if (typeof row.constraints === 'string') {
          try { row.constraints = JSON.parse(row.constraints); } catch (e) { row.constraints = {}; }
        }
        if (typeof row.default_value === 'string') {
          try { row.default_value = JSON.parse(row.default_value); } catch (e) { row.default_value = null; }
        }
        return row;
      });
    } else {
      model.io_definitions = [];
    }

    // Ensure JSON columns are returned as objects, not strings
    if (typeof model.pricing_config === 'string') {
      try { model.pricing_config = JSON.parse(model.pricing_config); } catch (e) { /* keep as-is */ }
    }
    if (typeof model.parameter_schema === 'string') {
      try { model.parameter_schema = JSON.parse(model.parameter_schema); } catch (e) { /* keep as-is */ }
    }

    return res.status(HTTP_STATUS_CODES.OK).json(model);
  } catch (err) {
    console.error('Error reading AI model:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || 'Internal Server Error' });
  }
};

/**
 * Update AI Model (status cannot be updated here; use PATCH /models/:amrId/status)
 */
exports.update = async function (req, res) {
  try {
    const amrId = req.params.amrId;
    const updateData = { ...req.body };

    // Fetch existing model to compare
    const existingModel = await aiRegistryModel.getAiModelById(amrId);
    if (!existingModel) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).send({ message: req.t('ai_model:AI_MODEL_NOT_FOUND') || 'AI Model not found' });
    }

    // Check if status allows editing (only active and draft are editable)
    const editableStatuses = ['active', 'draft'];
    if (!editableStatuses.includes(existingModel.status)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).send({
        message: `Models with status '${existingModel.status}' cannot be updated.`
      });
    }

    // Extract special fields
    const tagIds = updateData.tags;
    delete updateData.tags;
    delete updateData.status;

    // Clean up readonly fields
    delete updateData.amr_id;
    delete updateData.created_at;
    delete updateData.updated_at;
    delete updateData.slug;
    delete updateData.amc_id;
    delete updateData.provider;

    // IO Definitions might be passed for version check/clone
    const incomingIoDefinitions = updateData.io_definitions;
    delete updateData.io_definitions;

    // --- VERSIONING CHECK ---
    let needsVersioning = false;

    // Versioning only applies if the model is already ACTIVE. 
    // Draft models can change params/IO without bumping version.
    if (existingModel.status === 'active') {

      // 1. Check Parameter Schema Change
      if (updateData.parameter_schema) {
        const newSchemaStr = JSON.stringify(updateData.parameter_schema);
        const existingSchemaStr = typeof existingModel.parameter_schema === 'string'
          ? existingModel.parameter_schema
          : JSON.stringify(existingModel.parameter_schema || {});

        // Compare non-empty schemas
        if (newSchemaStr !== existingSchemaStr) {
          // If both are empty objects {}, ignore
          if (newSchemaStr !== '{}' || existingSchemaStr !== '{}') {
            needsVersioning = true;
          }
        }
      }

      // 2. Check IO Definition Change - IF provided
      if (!needsVersioning && incomingIoDefinitions) {
        const existingIos = await aiRegistryModel.getIoDefinitionsByModelId(amrId);

        const scrub = (list) => {
          if (!Array.isArray(list)) return [];
          // Sort by unique name to ensure order doesn't matter
          const sorted = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

          return sorted.map(i => {
            // Remove ID, timestamps, and transient fields for comparison
            // Also remove _tid (frontend temp ID)
            const { amiod_id, amr_id, updated_at, created_at, socket_type, _tid, ...rest } = i;

            // Normalization: Ensure all comparable fields are strings or consistently typed
            // Handle booleans (0/1 vs true/false) which might differ from DB vs JSON
            if (rest.is_required !== undefined) rest.is_required = !!rest.is_required;
            if (rest.is_list !== undefined) rest.is_list = !!rest.is_list;
            if (rest.sort_order !== undefined) rest.sort_order = parseInt(rest.sort_order, 10) || 0;

            // Stringify objects for deep comparison, cleaning keys to ensure order
            if (rest.default_value !== undefined) {
              rest.default_value = JSON.stringify(rest.default_value);
            }
            if (rest.constraints !== undefined) {
              // Start empty if null/undefined
              const c = rest.constraints || {};
              // Sort keys of constraints object
              const sortedConstraints = Object.keys(c).sort().reduce((acc, key) => {
                acc[key] = c[key];
                return acc;
              }, {});
              rest.constraints = JSON.stringify(sortedConstraints);
            }

            return rest;
          });
        };

        const cur = JSON.stringify(scrub(existingIos));
        const incoming = JSON.stringify(scrub(incomingIoDefinitions));

        if (cur !== incoming) {
          needsVersioning = true;
        }
      }
    }

    if (needsVersioning) {
      // --- VERSION BUMP FLOW ---

      // 1. Deprecate Old Model
      await aiRegistryModel.updateAiModel(amrId, { status: 'deprecated' });

      // 2. Compute New Version
      const oldVersion = existingModel.version || '1.0.0';
      // Simple semantic version increment (patch)
      const parts = oldVersion.replace(/[^0-9.]/g, '').split('.');
      if (parts.length >= 3) {
        parts[2] = parseInt(parts[2], 10) + 1;
      } else {
        parts.push('1');
      }
      const newVersion = parts.slice(0, 3).join('.');

      // 3. Prepare New Model Data
      const newModelData = {
        ...existingModel,
        ...updateData,
        version: newVersion,
        status: 'active',
        amr_id: undefined,
        created_at: undefined,
        updated_at: undefined
      };

      // Ensure JSON columns are proper objects before createAiModel (which calls JSON.stringify).
      // existingModel fields come from the DB as strings; if not overridden by updateData
      // they'd be double-stringified by createAiModel.
      if (typeof newModelData.pricing_config === 'string') {
        try { newModelData.pricing_config = JSON.parse(newModelData.pricing_config); } catch (e) { /* keep as-is */ }
      }
      if (typeof newModelData.parameter_schema === 'string') {
        try { newModelData.parameter_schema = JSON.parse(newModelData.parameter_schema); } catch (e) { /* keep as-is */ }
      }

      // 4. Create New Model
      const createResult = await aiRegistryModel.createAiModel(newModelData);
      const newAmrId = createResult.insertId;

      // 5. Clone/Create IO Definitions
      let iosToCreate = incomingIoDefinitions;
      if (!iosToCreate) {
        // If not provided in request, copy from old model
        iosToCreate = await aiRegistryModel.getIoDefinitionsByModelId(amrId);
      }

      if (iosToCreate && iosToCreate.length > 0) {
        for (const io of iosToCreate) {
          const { amiod_id, amr_id, socket_type, created_at, updated_at, ...ioData } = io;
          ioData.amr_id = newAmrId;
          await aiRegistryModel.createIoDefinition(ioData);
        }
      }

      // 6. Clone Tags
      let tagsToSet = tagIds;
      if (tagsToSet === undefined) {
        const existingTags = await aiRegistryModel.getTagsForAmrId(amrId);
        tagsToSet = existingTags.map(t => t.amtd_id);
      }

      if (tagsToSet && tagsToSet.length > 0) {
        const formattedTags = tagsToSet.map(t => (typeof t === 'object' && t?.amtd_id) ? t.amtd_id : t).filter(Boolean);
        await aiRegistryModel.setTagsForAmrId(newAmrId, formattedTags);
      }

      await publishNewAdminActivityLog({
        adminUserId: req.user.userId,
        entityType: 'AI_REGISTRY',
        actionName: 'VERSION_BUMP_AI_REGISTRY_MODEL',
        entityId: newAmrId,
        details: `Upgraded from ${amrId} (${oldVersion}) to ${newAmrId} (${newVersion})`
      });

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'Model upgraded to new version',
        new_amr_id: newAmrId,
        version: newVersion
      });

    } else {
      // --- NORMAL UPDATE ---

      if (tagIds !== undefined) {
        const amtdIds = Array.isArray(tagIds) ? tagIds.map(t => (typeof t === 'object' && t != null && t.amtd_id != null) ? t.amtd_id : t).filter(Boolean) : [];
        await aiRegistryModel.setTagsForAmrId(amrId, amtdIds);
      }

      await aiRegistryModel.updateAiModel(amrId, updateData);

      await publishNewAdminActivityLog({
        adminUserId: req.user.userId,
        entityType: 'AI_REGISTRY',
        actionName: 'UPDATE_AI_REGISTRY_MODEL',
        entityId: parseInt(amrId, 10)
      });
      return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:AI_MODEL_UPDATED_SUCCESSFULLY') || 'Updated successfully' });
    }

  } catch (err) {
    console.error('Error updating AI model:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || 'Internal Server Error' });
  }
};

/**
 * Update AI Model status only (active / inactive). Uses dedicated activity log action.
 */
exports.updateStatus = async function (req, res) {
  try {
    const amrId = req.params.amrId;
    const { status } = req.body;

    const allowed = ['active', 'inactive'];
    if (!status || !allowed.includes(status)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).send({
        message: req.t('ai_model:STATUS_REQUIRED') || 'status is required and must be "active" or "inactive".'
      });
    }

    const model = await aiRegistryModel.getAiModelById(amrId);
    if (!model) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).send({ message: req.t('ai_model:AI_MODEL_NOT_FOUND') || 'AI Model not found' });
    }

    await aiRegistryModel.updateAiModel(amrId, { status });
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY',
      actionName: 'UPDATE_AI_REGISTRY_MODEL_STATUS',
      entityId: parseInt(amrId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:AI_MODEL_UPDATED_SUCCESSFULLY') || 'Updated successfully', status });
  } catch (err) {
    console.error('Error updating AI model status:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || 'Internal Server Error' });
  }
};

/**
 * List Providers
 */
exports.listProviders = async function (req, res) {
  try {
    const providers = await aiRegistryModel.listProviders();
    const storageProvider = StorageFactory.getProvider();

    const providersWithLogos = await Promise.all(providers.map(async (p) => {
      if (p.provider_logo_key) {
        if (p.provider_logo_bucket === 'public') {
          p.provider_logo_url = `${storageProvider.publicBucketUrl}/${p.provider_logo_key}`;
        } else {
          p.provider_logo_url = await storageProvider.generatePresignedDownloadUrl(p.provider_logo_key);
        }
      }
      return p;
    }));

    return res.status(HTTP_STATUS_CODES.OK).json(providersWithLogos);
  } catch (err) {
    console.error('Error listing providers:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * Create Provider
 */
exports.createProvider = async function (req, res) {
  try {
    const data = req.body;
    if (!data.name || !data.slug) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).send({ message: req.t('ai_model:PROVIDER_NAME_SLUG_REQUIRED') || 'Name and slug are required.' });
    }
    const result = await aiRegistryModel.createProvider(data);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY_PROVIDER',
      actionName: 'CREATE_AI_REGISTRY_PROVIDER',
      entityId: result.insertId
    });
    return res.status(HTTP_STATUS_CODES.CREATED).json({ amp_id: result.insertId, ...data });
  } catch (err) {
    console.error('Error creating provider:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * Update Provider
 */
exports.updateProvider = async function (req, res) {
  try {
    const ampId = req.params.ampId;
    const updateData = req.body;

    // Prevent updating ID
    delete updateData.amp_id;
    delete updateData.created_at;
    delete updateData.updated_at;

    await aiRegistryModel.updateProvider(ampId, updateData);
    const updateKeys = Object.keys(updateData);
    const isStatusOnly = updateKeys.length === 1 && (Object.prototype.hasOwnProperty.call(updateData, 'is_active') || Object.prototype.hasOwnProperty.call(updateData, 'status'));
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY_PROVIDER',
      actionName: isStatusOnly ? 'UPDATE_AI_REGISTRY_PROVIDER_STATUS' : 'UPDATE_AI_REGISTRY_PROVIDER',
      entityId: parseInt(ampId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:PROVIDER_UPDATED_SUCCESSFULLY') || 'Updated successfully' });
  } catch (err) {
    console.error('Error updating provider:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * List Categories
 */
exports.listCategories = async function (req, res) {
  try {
    const categories = await aiRegistryModel.listCategories();
    return res.status(HTTP_STATUS_CODES.OK).json(categories);
  } catch (err) {
    console.error('Error listing categories:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * List Socket Types
 */
exports.listSocketTypes = async function (req, res) {
  try {
    const types = await aiRegistryModel.listSocketTypes();
    return res.status(HTTP_STATUS_CODES.OK).json(types);
  } catch (err) {
    console.error('Error listing socket types:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * Create IO Definition
 */
exports.createIoDefinition = async function (req, res) {
  try {
    const data = {
      ...req.body,
      amr_id: req.params.amrId // Ensure it links to the current model
    };
    const result = await aiRegistryModel.createIoDefinition(data);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY_IO',
      actionName: 'CREATE_AI_REGISTRY_IO',
      entityId: result.insertId
    });
    return res.status(HTTP_STATUS_CODES.CREATED).json({ amiod_id: result.insertId, ...data });
  } catch (err) {
    console.error('Error creating IO definition:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * Update IO Definition
 */
exports.updateIoDefinition = async function (req, res) {
  try {
    const amiodId = req.params.amiodId;
    await aiRegistryModel.updateIoDefinition(amiodId, req.body);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY_IO',
      actionName: 'UPDATE_AI_REGISTRY_IO',
      entityId: parseInt(amiodId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:IO_UPDATED_SUCCESSFULLY') || 'Updated successfully' });
  } catch (err) {
    console.error('Error updating IO definition:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};

/**
 * Delete IO Definition
 */
exports.deleteIoDefinition = async function (req, res) {
  try {
    const amiodId = req.params.amiodId;
    await aiRegistryModel.deleteIoDefinition(amiodId);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY_IO',
      actionName: 'DELETE_AI_REGISTRY_IO',
      entityId: parseInt(amiodId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:IO_DELETED_SUCCESSFULLY') || 'Deleted successfully' });
  } catch (err) {
    console.error('Error deleting IO definition:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || err.message });
  }
};
