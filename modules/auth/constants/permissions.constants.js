'use strict';

/**
 * Permission Constants
 * 
 * Centralized permission codes for type-safe permission checking.
 * These codes must match the permission_code values in the admin_permission table.
 */

const PERMISSIONS = {
  // Pricing Management
  MANAGE_PRICING: 'manage_pricing',
  VIEW_PRICING: 'view_pricing',
  
  // Content Management
  MANAGE_CONTENT: 'manage_content',
  
  // User Management
  MANAGE_USERS: 'manage_users',
  
  // Analytics
  VIEW_ANALYTICS: 'view_analytics',
  
  // Settings
  MANAGE_SETTINGS: 'manage_settings'
};

/**
 * Permission Groups
 * Useful for checking multiple related permissions
 */
const PERMISSION_GROUPS = {
  PRICING: [PERMISSIONS.MANAGE_PRICING, PERMISSIONS.VIEW_PRICING],
  CONTENT: [PERMISSIONS.MANAGE_CONTENT],
  ADMINISTRATION: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_SETTINGS]
};

/**
 * Role Names
 * Centralized role names matching the database
 */
const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor'
};

module.exports = {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLES
};
