'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

// In-memory cache for user permissions
// Format: { userId: { permissions: [...], roles: [...], expiresAt: timestamp } }
// 
// NOTE: This in-memory cache is suitable for admin panels with low user counts (<500).
// For higher scale or multi-instance deployments, consider migrating to Redis.
// See: modules/templates/services/template.redis.service.js for Redis patterns.
const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500; // Maximum number of users to cache

/**
 * Set cache entry with LRU-like eviction when max size reached
 * Evicts oldest entries (by expiresAt) when cache is full
 */
function setCacheEntry(userId, data) {
  // If at max size and this is a new entry, evict oldest
  if (permissionCache.size >= MAX_CACHE_SIZE && !permissionCache.has(userId)) {
    // Find and delete the oldest entry (lowest expiresAt)
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, value] of permissionCache) {
      if (value.expiresAt < oldestTime) {
        oldestTime = value.expiresAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      permissionCache.delete(oldestKey);
    }
  }
  
  permissionCache.set(userId, data);
}

/**
 * Get user roles by user ID
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of role objects with role_id and role_name
 */
exports.getUserRoles = async function(userId) {
  // Step 1: Get role IDs for the user
  const userRoleQuery = `
    SELECT role_id
    FROM admin_user_role
    WHERE user_id = ? AND deleted_at IS NULL
  `;
  
  const userRoles = await mysqlQueryRunner.runQueryInMaster(userRoleQuery, [userId]);
  
  if (!userRoles || userRoles.length === 0) {
    return [];
  }
  
  const roleIds = userRoles.map(ur => ur.role_id);
  
  // Step 2: Fetch role details
  const roleQuery = `
    SELECT 
      role_id,
      role_name,
      role_description
    FROM admin_role
    WHERE role_id IN (?) AND deleted_at IS NULL
    ORDER BY role_name
  `;
  
  return await mysqlQueryRunner.runQueryInMaster(roleQuery, [roleIds]);
};

/**
 * Get user permissions by user ID
 * Fetches permissions through roles
 * @param {string} userId - User ID
 * @param {boolean} useCache - Whether to use cache (default: true)
 * @returns {Promise<Array>} Array of permission objects with permission_code
 */
exports.getUserPermissions = async function(userId, useCache = true) {
  // Check cache first
  if (useCache) {
    const cached = permissionCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }
  }

  // Step 1: Get role IDs for the user
  const userRoleQuery = `
    SELECT role_id
    FROM admin_user_role
    WHERE user_id = ? AND deleted_at IS NULL
  `;
  
  const userRoles = await mysqlQueryRunner.runQueryInMaster(userRoleQuery, [userId]);
  
  if (!userRoles || userRoles.length === 0) {
    return [];
  }
  
  const roleIds = userRoles.map(ur => ur.role_id);
  
  // Step 2: Get permission IDs for these roles
  const rolePermissionQuery = `
    SELECT permission_id
    FROM admin_role_permission
    WHERE role_id IN (?) AND deleted_at IS NULL
  `;
  
  const rolePermissions = await mysqlQueryRunner.runQueryInMaster(rolePermissionQuery, [roleIds]);
  
  if (!rolePermissions || rolePermissions.length === 0) {
    return [];
  }
  
  // Deduplicate permission IDs in JavaScript (more efficient than SQL DISTINCT)
  const permissionIds = [...new Set(rolePermissions.map(rp => rp.permission_id))];
  
  // Step 3: Fetch permission details
  const permissionQuery = `
    SELECT 
      admin_permission_id,
      permission_name,
      permission_code,
      permission_description
    FROM admin_permission
    WHERE admin_permission_id IN (?) AND deleted_at IS NULL
    ORDER BY permission_name
  `;
  
  const permissions = await mysqlQueryRunner.runQueryInMaster(permissionQuery, [permissionIds]);
  
  // Cache the result
  if (useCache) {
    const roles = await this.getUserRoles(userId);
    setCacheEntry(userId, {
      permissions,
      roles,
      expiresAt: Date.now() + CACHE_TTL
    });
  }
  
  return permissions;
};

/**
 * Get user roles and permissions together
 * @param {string} userId - User ID
 * @param {boolean} useCache - Whether to use cache (default: true)
 * @returns {Promise<Object>} Object with roles and permissions arrays
 */
exports.getUserRolesAndPermissions = async function(userId, useCache = true) {
  // Check cache first
  if (useCache) {
    const cached = permissionCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        roles: cached.roles,
        permissions: cached.permissions
      };
    }
  }

  const [roles, permissions] = await Promise.all([
    this.getUserRoles(userId),
    this.getUserPermissions(userId, false) // Don't cache twice
  ]);

  // Cache the result
  if (useCache) {
    setCacheEntry(userId, {
      permissions,
      roles,
      expiresAt: Date.now() + CACHE_TTL
    });
  }

  return { roles, permissions };
};

/**
 * Check if user has a specific permission
 * @param {string} userId - User ID
 * @param {string} permissionCode - Permission code to check
 * @returns {Promise<boolean>} True if user has the permission
 */
exports.userHasPermission = async function(userId, permissionCode) {
  const permissions = await this.getUserPermissions(userId);
  return permissions.some(p => p.permission_code === permissionCode);
};

/**
 * Check if user has a specific role
 * @param {string} userId - User ID
 * @param {string} roleName - Role name to check
 * @returns {Promise<boolean>} True if user has the role
 */
exports.userHasRole = async function(userId, roleName) {
  const roles = await this.getUserRoles(userId);
  return roles.some(r => r.role_name === roleName);
};

/**
 * Check if user has any of the specified permissions
 * @param {string} userId - User ID
 * @param {Array<string>} permissionCodes - Array of permission codes
 * @returns {Promise<boolean>} True if user has at least one permission
 */
exports.userHasAnyPermission = async function(userId, permissionCodes) {
  const permissions = await this.getUserPermissions(userId);
  const userPermissionCodes = permissions.map(p => p.permission_code);
  return permissionCodes.some(code => userPermissionCodes.includes(code));
};

/**
 * Check if user has all of the specified permissions
 * @param {string} userId - User ID
 * @param {Array<string>} permissionCodes - Array of permission codes
 * @returns {Promise<boolean>} True if user has all permissions
 */
exports.userHasAllPermissions = async function(userId, permissionCodes) {
  const permissions = await this.getUserPermissions(userId);
  const userPermissionCodes = permissions.map(p => p.permission_code);
  return permissionCodes.every(code => userPermissionCodes.includes(code));
};

/**
 * Clear permission cache for a user
 * @param {string} userId - User ID
 */
exports.clearUserCache = function(userId) {
  if (userId) {
    permissionCache.delete(userId);
  } else {
    // Clear all cache
    permissionCache.clear();
  }
};

/**
 * Get all permissions
 * @returns {Promise<Array>} Array of all permission objects
 */
exports.getAllPermissions = async function() {
  const query = `
    SELECT 
      admin_permission_id,
      permission_name,
      permission_code,
      permission_description,
      created_at,
      updated_at
    FROM admin_permission
    WHERE deleted_at IS NULL
    ORDER BY permission_name
  `;
  
  return await mysqlQueryRunner.runQueryInMaster(query, []);
};

/**
 * Get all roles
 * @returns {Promise<Array>} Array of all role objects
 */
exports.getAllRoles = async function() {
  const query = `
    SELECT 
      role_id,
      role_name,
      role_description,
      created_at,
      updated_at
    FROM admin_role
    WHERE deleted_at IS NULL
    ORDER BY role_name
  `;
  
  return await mysqlQueryRunner.runQueryInMaster(query, []);
};

/**
 * Get role with its permissions
 * @param {string} roleId - Role ID
 * @returns {Promise<Object>} Role object with permissions array
 */
exports.getRoleWithPermissions = async function(roleId) {
  // Step 1: Fetch role details
  const roleQuery = `
    SELECT 
      role_id,
      role_name,
      role_description,
      created_at,
      updated_at
    FROM admin_role
    WHERE role_id = ? AND deleted_at IS NULL
  `;
  
  const roles = await mysqlQueryRunner.runQueryInMaster(roleQuery, [roleId]);
  
  if (!roles || roles.length === 0) {
    return null;
  }
  
  // Step 2: Get permission IDs for this role
  const rolePermissionQuery = `
    SELECT permission_id
    FROM admin_role_permission
    WHERE role_id = ? AND deleted_at IS NULL
  `;
  
  const rolePermissions = await mysqlQueryRunner.runQueryInMaster(rolePermissionQuery, [roleId]);
  
  if (!rolePermissions || rolePermissions.length === 0) {
    return {
      ...roles[0],
      permissions: []
    };
  }
  
  const permissionIds = rolePermissions.map(rp => rp.permission_id);
  
  // Step 3: Fetch permission details
  const permissionQuery = `
    SELECT 
      admin_permission_id,
      permission_name,
      permission_code,
      permission_description
    FROM admin_permission
    WHERE admin_permission_id IN (?) AND deleted_at IS NULL
    ORDER BY permission_name
  `;
  
  const permissions = await mysqlQueryRunner.runQueryInMaster(permissionQuery, [permissionIds]);
  
  return {
    ...roles[0],
    permissions
  };
};
