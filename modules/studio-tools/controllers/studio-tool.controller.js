'use strict';

const { v7: uuidv7 } = require('uuid');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const StudioToolModel = require('../models/studio-tool.model');
const StudioToolErrorHandler = require('../middlewares/studio-tool.error.handler');
const logger = require('../../../config/lib/logger');

exports.listStudioTools = async function (req, res) {
  try {
    const tools = await StudioToolModel.listStudioTools({ includeInactive: true });
    const pageConfig = await StudioToolModel.getPageConfig();
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: tools,
      page_config: pageConfig,
    });
  } catch (error) {
    logger.error('Error listing studio tools:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.getPageConfig = async function (req, res) {
  try {
    const pageConfig = await StudioToolModel.getPageConfig();
    return res.status(HTTP_STATUS_CODES.OK).json({ data: pageConfig });
  } catch (error) {
    logger.error('Error getting studio page config:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.updatePageConfig = async function (req, res) {
  try {
    const updated = await StudioToolModel.updatePageConfig(req.validatedBody);
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Page config not found' });
    }
    const pageConfig = await StudioToolModel.getPageConfig();
    return res.status(HTTP_STATUS_CODES.OK).json({ data: pageConfig });
  } catch (error) {
    logger.error('Error updating studio page config:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.createStudioTool = async function (req, res) {
  try {
    const payload = { ...req.validatedBody };
    const studioToolId = uuidv7();
    if (payload.sort_order == null) {
      payload.sort_order = await StudioToolModel.getNextSortOrder();
    }
    if (payload.is_featured) {
      await StudioToolModel.clearFeaturedExcept(studioToolId);
    }

    await StudioToolModel.createStudioTool({
      studio_tool_id: studioToolId,
      ...payload,
    });

    const tool = await StudioToolModel.getStudioToolById(studioToolId);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data: tool });
  } catch (error) {
    logger.error('Error creating studio tool:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.updateStudioTool = async function (req, res) {
  try {
    const { toolId } = req.params;
    const existing = await StudioToolModel.getStudioToolById(toolId);
    if (!existing) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Studio tool not found' });
    }

    const payload = { ...req.validatedBody };
    if (payload.is_featured === true) {
      await StudioToolModel.clearFeaturedExcept(toolId);
    }

    const updated = await StudioToolModel.updateStudioTool(toolId, payload);
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Studio tool not found' });
    }

    const tool = await StudioToolModel.getStudioToolById(toolId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: tool });
  } catch (error) {
    logger.error('Error updating studio tool:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.archiveStudioTool = async function (req, res) {
  try {
    const { toolId } = req.params;
    const archived = await StudioToolModel.archiveStudioTool(toolId);
    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Studio tool not found' });
    }
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Studio tool archived' });
  } catch (error) {
    logger.error('Error archiving studio tool:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};

exports.updateSortOrder = async function (req, res) {
  try {
    const { tool_ids: toolIds } = req.validatedBody;
    const existingIds = await StudioToolModel.getActiveToolIds();
    const sortedExisting = [...existingIds].sort();
    const sortedRequest = [...toolIds].sort();

    if (
      sortedExisting.length !== sortedRequest.length ||
      sortedExisting.some((id, index) => id !== sortedRequest[index])
    ) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'tool_ids must include every active studio tool exactly once',
      });
    }

    await StudioToolModel.updateSortOrder(toolIds);
    const tools = await StudioToolModel.listStudioTools({ includeInactive: true });
    return res.status(HTTP_STATUS_CODES.OK).json({ data: tools });
  } catch (error) {
    logger.error('Error updating studio tools sort order:', { error: error.message, stack: error.stack });
    StudioToolErrorHandler.handleStudioToolErrors(error, res);
  }
};
