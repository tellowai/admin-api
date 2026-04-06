'use strict';
const JWT = require('jsonwebtoken');
const config = require('../../../config/config');
const RbacModel = require('../models/rbac.model');
const logger = require('../../../config/lib/logger');

exports.generateToken = function (user, next) {
  // Use async IIFE to handle async operations with callback
  (async () => {
    try {
      // Always read fresh RBAC for minted tokens (avoid stale in-memory cache between login/refresh)
      const { roles, permissions } = await RbacModel.getUserRolesAndPermissions(user.user_id, false);
      
      // Extract permission codes for easier checking
      const permissionCodes = permissions.map(p => p.permission_code);
      
      // Extract role names
      const roleNames = roles.map(r => r.role_name);
      
      // Determine if user is admin (has any role)
      const isAdmin = roles.length > 0;

      let payload = {
        userId: user.user_id,
        v: 'v1',
        isAdmin: isAdmin,
        roles: roleNames,
        permissions: permissionCodes
      };

      if(user.pc_id) {
        payload.pcId = user.pc_id;
      }

      var jwtToken = JWT.sign(payload, 
        config.jwt.secret, { 
          expiresIn: config.jwt.expiresIn
        }
      );

      // Clear user cache after generating token to ensure fresh data on next request
      RbacModel.clearUserCache(user.user_id);

      if (typeof next === 'function') {
        next(jwtToken);
      }
    } catch (error) {
      logger.error('generateToken: RBAC fetch failed; issuing minimal JWT (isAdmin false, empty roles)', {
        userId: user.user_id,
        errName: error.name,
        errMessage: error.message
      });
      // Fallback to basic token if RBAC fetch fails
      let payload = {
        userId: user.user_id,
        v: 'v1',
        isAdmin: false,
        roles: [],
        permissions: []
      };

      if(user.pc_id) {
        payload.pcId = user.pc_id;
      }

      var jwtToken = JWT.sign(payload, 
        config.jwt.secret, { 
          expiresIn: config.jwt.expiresIn
        }
      );

      if (typeof next === 'function') {
        next(jwtToken);
      }
    }
  })();
};
