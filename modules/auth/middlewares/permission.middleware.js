'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const RbacModel = require('../models/rbac.model');
const { ROLES } = require('../constants/permissions.constants');

/**
 * Middleware to check if user has a specific permission
 * Must be used after isAdminUser middleware
 * 
 * @param {string} permissionCode - Permission code to check
 * @returns {Function} Express middleware function
 */
exports.hasPermission = function(permissionCode) {
  return async function(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
          message: req.t('UNAUTHORIZED')
        });
      }

      const hasPermission = await RbacModel.userHasPermission(
        req.user.userId,
        permissionCode
      );

      if (!hasPermission) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('PERMISSION_DENIED') || 'You do not have permission to perform this action'
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify permissions'
      });
    }
  };
};

/**
 * Middleware to check if user has any of the specified permissions
 * Must be used after isAdminUser middleware
 * 
 * @param {Array<string>} permissionCodes - Array of permission codes (user needs at least one)
 * @returns {Function} Express middleware function
 */
exports.hasAnyPermission = function(permissionCodes) {
  return async function(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
          message: req.t('UNAUTHORIZED')
        });
      }

      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Invalid permission codes provided'
        });
      }

      const hasPermission = await RbacModel.userHasAnyPermission(
        req.user.userId,
        permissionCodes
      );

      if (!hasPermission) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('PERMISSION_DENIED') || 'You do not have permission to perform this action'
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify permissions'
      });
    }
  };
};

/**
 * Middleware to check if user has all of the specified permissions
 * Must be used after isAdminUser middleware
 * 
 * @param {Array<string>} permissionCodes - Array of permission codes (user needs all)
 * @returns {Function} Express middleware function
 */
exports.hasAllPermissions = function(permissionCodes) {
  return async function(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
          message: req.t('UNAUTHORIZED')
        });
      }

      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Invalid permission codes provided'
        });
      }

      const hasPermission = await RbacModel.userHasAllPermissions(
        req.user.userId,
        permissionCodes
      );

      if (!hasPermission) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('PERMISSION_DENIED') || 'You do not have permission to perform this action'
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify permissions'
      });
    }
  };
};

/**
 * Middleware to check if user has a specific role
 * Must be used after isAdminUser middleware
 * 
 * @param {string} roleName - Role name to check
 * @returns {Function} Express middleware function
 */
exports.hasRole = function(roleName) {
  return async function(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
          message: req.t('UNAUTHORIZED')
        });
      }

      const hasRole = await RbacModel.userHasRole(
        req.user.userId,
        roleName
      );

      if (!hasRole) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('PERMISSION_DENIED') || 'You do not have permission to perform this action'
        });
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify role'
      });
    }
  };
};

/**
 * Middleware to check if user is owner
 * Must be used after isAdminUser middleware
 * 
 * @returns {Function} Express middleware function
 */
exports.isOwner = function() {
  return exports.hasRole(ROLES.OWNER);
};

/**
 * Middleware to check if user is owner or admin (not editor)
 * Must be used after isAdminUser middleware
 * 
 * @returns {Function} Express middleware function
 */
exports.isOwnerOrAdmin = function() {
  return async function(req, res, next) {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
          message: req.t('UNAUTHORIZED')
        });
      }

      const roles = await RbacModel.getUserRoles(req.user.userId);
      const roleNames = roles.map(r => r.role_name);
      
      const isOwnerOrAdmin = roleNames.includes(ROLES.OWNER) || roleNames.includes(ROLES.ADMIN);

      if (!isOwnerOrAdmin) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('PERMISSION_DENIED') || 'You do not have permission to perform this action'
        });
      }

      // Store roles in req.user for later use in controllers
      req.user.roles = roleNames;

      next();
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify role'
      });
    }
  };
};
