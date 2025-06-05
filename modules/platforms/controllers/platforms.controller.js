'use strict';

const platformsModel = require('../models/platforms.model');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * Get all platforms
 */
exports.getAllPlatforms = async (req, res) => {
  try {
    const platforms = await platformsModel.getAllPlatforms();
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: platforms
    });
  } catch (error) {
    console.error('Error fetching platforms:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching platforms',
      error: error.message
    });
  }
};

/**
 * Get a single platform by ID
 */
exports.getPlatformById = async (req, res) => {
  try {
    const platformId = req.params.platformId;
    
    if (!platformId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform ID is required'
      });
    }
    
    const platform = await platformsModel.getPlatformById(platformId);
    
    if (!platform) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'Platform not found'
      });
    }
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: platform
    });
  } catch (error) {
    console.error('Error fetching platform by ID:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while fetching platform',
      error: error.message
    });
  }
};

/**
 * Create a new platform
 */
exports.createPlatform = async (req, res) => {
  try {
    const platformData = req.body;
    
    // Validate required fields
    if (!platformData.name) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform name is required'
      });
    }
    
    // Check if platform name already exists
    const existingPlatform = await platformsModel.getPlatformByName(platformData.name);
    if (existingPlatform) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'A platform with this name already exists'
      });
    }
    
    const result = await platformsModel.createPlatform(platformData);
    
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: 'Platform created successfully',
      data: {
        platform_id: result.insertId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error creating platform:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while creating platform',
      error: error.message
    });
  }
};

/**
 * Update a platform
 */
exports.updatePlatform = async (req, res) => {
  try {
    const platformId = req.params.platformId;
    const platformData = req.body;
    
    if (!platformId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform ID is required'
      });
    }
    
    // Check if platform exists
    const existingPlatform = await platformsModel.getPlatformById(platformId);
    if (!existingPlatform) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'Platform not found'
      });
    }
    
    // If name is being updated, check if it already exists
    if (platformData.name && platformData.name !== existingPlatform.name) {
      const existingPlatformByName = await platformsModel.getPlatformByName(platformData.name);
      if (existingPlatformByName) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'A platform with this name already exists'
        });
      }
    }
    
    const result = await platformsModel.updatePlatform(platformId, platformData);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'Platform updated successfully',
      data: {
        platform_id: platformId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error updating platform:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while updating platform',
      error: error.message
    });
  }
};

/**
 * Delete a platform
 */
exports.deletePlatform = async (req, res) => {
  try {
    const platformId = req.params.platformId;
    
    if (!platformId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Platform ID is required'
      });
    }
    
    // Check if platform exists
    const existingPlatform = await platformsModel.getPlatformById(platformId);
    if (!existingPlatform) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: 'Platform not found'
      });
    }
    
    const result = await platformsModel.deletePlatform(platformId);
    
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'Platform deleted successfully',
      data: {
        platform_id: platformId,
        ...result
      }
    });
  } catch (error) {
    console.error('Error deleting platform:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: 'Server error while deleting platform',
      error: error.message
    });
  }
}; 