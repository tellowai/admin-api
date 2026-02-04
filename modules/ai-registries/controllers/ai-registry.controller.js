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
    const providersMap = _.keyBy(providers, 'amp_id');

    const result = models.map(model => ({
      ...model,
      provider: providersMap[model.amp_id] || null
    }));

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
      is_active: 1, // Default active
      parameter_schema: req.body.parameter_schema || {},
      pricing_config: req.body.pricing_config || {},
      icon_url: req.body.icon_url,
      documentation_url: req.body.documentation_url
    };

    const result = await aiRegistryModel.createAiModel(newModelData);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY',
      actionName: 'CREATE_AI_REGISTRY_MODEL',
      entityId: result.insertId
    });
    return res.status(HTTP_STATUS_CODES.CREATED).json({ amr_id: result.insertId, ...newModelData });
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

      model.io_definitions = ioDefinitions.map(io => ({
        ...io,
        socket_type: socketTypesMap[io.amst_id] || null
      }));
    } else {
      model.io_definitions = [];
    }

    return res.status(HTTP_STATUS_CODES.OK).json(model);
  } catch (err) {
    console.error('Error reading AI model:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).send({ message: req.t('common:SOMETHING_WENT_WRONG') || 'Internal Server Error' });
  }
};

/**
 * Update AI Model
 */
exports.update = async function (req, res) {
  try {
    const amrId = req.params.amrId;
    const updateData = { ...req.body };

    // Handle tags separately (junction table ai_model_registry_tags)
    const tagIds = updateData.tags;
    delete updateData.tags;

    // Prevent updating ID and removed columns
    delete updateData.amr_id;
    delete updateData.created_at;
    delete updateData.updated_at;
    delete updateData.slug;
    delete updateData.amc_id; // Removed from ai_model_registry
    delete updateData.provider; // Read-only from join
    delete updateData.io_definitions; // Managed via IO endpoints

    if (tagIds !== undefined) {
      const amtdIds = Array.isArray(tagIds) ? tagIds.map(t => (typeof t === 'object' && t != null && t.amtd_id != null) ? t.amtd_id : t).filter(Boolean) : [];
      await aiRegistryModel.setTagsForAmrId(amrId, amtdIds);
    }

    await aiRegistryModel.updateAiModel(amrId, updateData);
    const updateKeys = Object.keys(updateData);
    const isStatusOnly = updateKeys.length === 1 && (Object.prototype.hasOwnProperty.call(updateData, 'is_active') || Object.prototype.hasOwnProperty.call(updateData, 'status'));
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'AI_REGISTRY',
      actionName: isStatusOnly ? 'UPDATE_AI_REGISTRY_MODEL_STATUS' : 'UPDATE_AI_REGISTRY_MODEL',
      entityId: parseInt(amrId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: req.t('ai_model:AI_MODEL_UPDATED_SUCCESSFULLY') || 'Updated successfully' });
  } catch (err) {
    console.error('Error updating AI model:', err);
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
