'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { createId } = require('@paralleldrive/cuid2');

/**
 * Get all roles
 * @param {number} limit - Pagination limit
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of role objects
 */
exports.getAllRoles = async function(limit, offset) {
  // Step 1: Fetch roles
  const roleQuery = `
    SELECT 
      role_id,
      role_name,
      role_description,
      created_at,
      updated_at
    FROM admin_role
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  
  const roles = await mysqlQueryRunner.runQueryInMaster(roleQuery, [limit, offset]);
  
  if (!roles || roles.length === 0) {
    return [];
  }
  
  const roleIds = roles.map(r => r.role_id);
  
  // Step 2: Fetch user counts for each role
  const userCountQuery = `
    SELECT role_id, COUNT(*) as user_count
    FROM admin_user_role
    WHERE role_id IN (?) AND deleted_at IS NULL
    GROUP BY role_id
  `;
  
  const userCounts = await mysqlQueryRunner.runQueryInMaster(userCountQuery, [roleIds]);
  const userCountMap = {};
  userCounts.forEach(uc => {
    userCountMap[uc.role_id] = parseInt(uc.user_count, 10);
  });
  
  // Step 3: Fetch permission counts for each role
  const permissionCountQuery = `
    SELECT role_id, COUNT(*) as permission_count
    FROM admin_role_permission
    WHERE role_id IN (?) AND deleted_at IS NULL
    GROUP BY role_id
  `;
  
  const permissionCounts = await mysqlQueryRunner.runQueryInMaster(permissionCountQuery, [roleIds]);
  const permissionCountMap = {};
  permissionCounts.forEach(pc => {
    permissionCountMap[pc.role_id] = parseInt(pc.permission_count, 10);
  });
  
  // Step 4: Stitch data together
  return roles.map(role => ({
    ...role,
    user_count: userCountMap[role.role_id] || 0,
    permission_count: permissionCountMap[role.role_id] || 0
  }));
};

/**
 * Get role by ID with permissions
 * @param {string} roleId - Role ID
 * @returns {Promise<Object|null>} Role object with permissions array
 */
exports.getRoleById = async function(roleId) {
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

/**
 * Create a new role
 * @param {Object} roleData - Role data with role_name and role_description
 * @returns {Promise<Object>} Created role object
 */
exports.createRole = async function(roleData) {
  const roleId = createId();
  const query = `
    INSERT INTO admin_role (role_id, role_name, role_description, created_at, updated_at)
    VALUES (?, ?, ?, NOW(), NOW())
  `;
  
  await mysqlQueryRunner.runQueryInMaster(query, [
    roleId,
    roleData.role_name,
    roleData.role_description
  ]);
  
  return await this.getRoleById(roleId);
};

/**
 * Update role
 * @param {string} roleId - Role ID
 * @param {Object} roleData - Updated role data
 * @returns {Promise<Object|null>} Updated role object
 */
exports.updateRole = async function(roleId, roleData) {
  const query = `
    UPDATE admin_role
    SET role_name = ?,
        role_description = ?,
        updated_at = NOW()
    WHERE role_id = ? AND deleted_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [
    roleData.role_name,
    roleData.role_description,
    roleId
  ]);
  
  if (result.affectedRows === 0) {
    return null;
  }
  
  return await this.getRoleById(roleId);
};

/**
 * Soft delete role
 * @param {string} roleId - Role ID
 * @returns {Promise<boolean>} True if deleted successfully
 */
exports.deleteRole = async function(roleId) {
  const query = `
    UPDATE admin_role
    SET deleted_at = NOW()
    WHERE role_id = ? AND deleted_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [roleId]);
  return result.affectedRows > 0;
};

/**
 * Assign permissions to role
 * @param {string} roleId - Role ID
 * @param {Array<string>} permissionIds - Array of permission IDs
 * @returns {Promise<number>} Number of permissions assigned
 */
exports.assignPermissionsToRole = async function(roleId, permissionIds) {
  if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
    return 0;
  }

  // Check existing assignments
  const checkQuery = `
    SELECT permission_id 
    FROM admin_role_permission 
    WHERE role_id = ? AND permission_id IN (?) AND deleted_at IS NULL
  `;
  
  const existing = await mysqlQueryRunner.runQueryInMaster(checkQuery, [roleId, permissionIds]);
  const existingIds = existing.map(e => e.permission_id);
  
  // Filter out already assigned permissions
  const newPermissionIds = permissionIds.filter(id => !existingIds.includes(id));
  
  if (newPermissionIds.length === 0) {
    return 0;
  }

  // Insert new assignments
  const insertData = newPermissionIds.map(permissionId => [
    createId(),
    roleId,
    permissionId
  ]);
  
  const insertQuery = `
    INSERT INTO admin_role_permission (admin_role_permission_id, role_id, permission_id, created_at, updated_at)
    VALUES ?
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, [insertData]);
  return result.affectedRows;
};

/**
 * Remove permission from role
 * @param {string} roleId - Role ID
 * @param {string} permissionId - Permission ID
 * @returns {Promise<boolean>} True if removed successfully
 */
exports.removePermissionFromRole = async function(roleId, permissionId) {
  const query = `
    UPDATE admin_role_permission
    SET deleted_at = NOW()
    WHERE role_id = ? AND permission_id = ? AND deleted_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [roleId, permissionId]);
  return result.affectedRows > 0;
};

/**
 * Update role permissions (replace all permissions)
 * @param {string} roleId - Role ID
 * @param {Array<string>} permissionIds - Array of permission IDs
 * @returns {Promise<number>} Number of permissions assigned
 */
exports.updateRolePermissions = async function(roleId, permissionIds) {
  // First, remove all existing permissions
  const removeQuery = `
    UPDATE admin_role_permission
    SET deleted_at = NOW()
    WHERE role_id = ? AND deleted_at IS NULL
  `;
  
  await mysqlQueryRunner.runQueryInMaster(removeQuery, [roleId]);
  
  // Then assign new permissions
  if (Array.isArray(permissionIds) && permissionIds.length > 0) {
    return await this.assignPermissionsToRole(roleId, permissionIds);
  }
  
  return 0;
};
