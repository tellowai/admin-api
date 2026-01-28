var mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const cuid = require('cuid');


exports.createNewAdminUser = async function(newAdminUserData) {
    const checkQuery = "SELECT * FROM admin_user_role WHERE role_id IN (?) AND user_id IN (?) AND DELETED_AT IS NULL";
    const insertQuery = "INSERT INTO admin_user_role (admin_user_role_id, role_id, user_id) VALUES ?";
    
    const roleIdArray = newAdminUserData.map(user => user.role_id);
    const userIdArray = newAdminUserData.map(user => user.user_id);
    
    const checkData = [roleIdArray, userIdArray];
    const checkResult = await mysqlQueryRunner.runQueryInMaster(checkQuery, checkData);

    const insertData = newAdminUserData.filter(user => {
        return !checkResult.find(result => result.role_id === user.role_id && result.user_id === user.user_id);
    }).map(user => [user.admin_user_role_id, user.role_id, user.user_id]);

    if (insertData.length > 0) {
        await mysqlQueryRunner.runQueryInMaster(insertQuery, [insertData]);
    }
    
    return newAdminUserData.length;
};

exports.getRoleIdsWithRoleNames = async function(roleNames) {
    const query = "SELECT role_id, role_name FROM admin_role WHERE role_name IN (?)";
    
    return await mysqlQueryRunner.runQueryInMaster(query, [roleNames]);
};

exports.deleteAdminUser = async function(userId) {
    const deleteQuery = "UPDATE admin_user_role SET DELETED_AT = NOW() WHERE user_id = ? AND DELETED_AT IS NULL";
    
    await mysqlQueryRunner.runQueryInMaster(deleteQuery, [userId]);
};

exports.getAdminUserIds = async function(limit, offset) {
    let selectAllQuery = "SELECT * FROM admin_user_role WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?";

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [limit, offset]);
};

exports.getUsersFromIds = async function(userIds) {
    let selectAllQuery = "SELECT user_id, email, display_name, profile_pic FROM user WHERE user_id IN (?)";

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [userIds]);
};

exports.bulkDeleteAdminUsers = async function(userIds) {
    const deleteQuery = "UPDATE admin_user_role SET DELETED_AT = NOW() WHERE user_id IN (?) AND DELETED_AT IS NULL";
    
    await mysqlQueryRunner.runQueryInMaster(deleteQuery, [userIds]);
};

exports.searchAdminUsersByEmail = async function(email, limit, offset) {
    // Escape single quotes to prevent SQL injection
    const escapedEmail = email.replace(/'/g, "''");
    const searchPattern = `%${escapedEmail}%`;
    
    let selectAllQuery = `SELECT user_id, username, email, display_name, profile_pic FROM user WHERE email LIKE ? AND DELETED_AT IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [searchPattern, limit, offset]);
};

exports.searchAdminUsersByEmailOrMobile = async function(emailOrmobile, limit, offset, searchType = 'both') {
    // Escape single quotes to prevent SQL injection
    const escapedSearch = emailOrmobile.replace(/'/g, "''");
    const searchPattern = `%${escapedSearch}%`;
    
    let whereClause = '';
    let queryParams = [];
    
    if (searchType === 'email') {
        whereClause = `email LIKE ?`;
        queryParams = [searchPattern];
    } else if (searchType === 'mobile') {
        whereClause = `mobile LIKE ?`;
        queryParams = [searchPattern];
    } else {
        // Default: search both email and mobile
        whereClause = `(email LIKE ? OR mobile LIKE ?)`;
        queryParams = [searchPattern, searchPattern];
    }
    
    // Add limit and offset to params
    queryParams.push(limit, offset);
    
    let selectAllQuery = `SELECT user_id, email, mobile, display_name, profile_pic FROM user WHERE ${whereClause} AND DELETED_AT IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, queryParams);
};

exports.getAdminUsersFromIds = async function(userIds) {
    let selectAllQuery = "SELECT admin_user_role_id, user_id, created_at, updated_at FROM admin_user_role WHERE user_id IN (?) AND DELETED_AT IS NULL";

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [userIds]);
};

/**
 * Get roles for multiple users
 * @param {Array<string>} userIds - Array of user IDs
 * @returns {Promise<Array>} Array of objects with user_id and roles array
 */
exports.getRolesForUsers = async function(userIds) {
    if (!userIds || userIds.length === 0) {
        return [];
    }
    
    // Step 1: Get user-role mappings
    const userRoleQuery = `
        SELECT 
            user_id,
            role_id
        FROM admin_user_role
        WHERE user_id IN (?)
            AND deleted_at IS NULL
        ORDER BY user_id
    `;
    
    const userRoles = await mysqlQueryRunner.runQueryInMaster(userRoleQuery, [userIds]);
    
    if (!userRoles || userRoles.length === 0) {
        return userIds.map(userId => ({
            user_id: userId,
            roles: []
        }));
    }
    
    // Step 2: Get unique role IDs
    const roleIds = [...new Set(userRoles.map(ur => ur.role_id))];
    
    // Step 3: Fetch role details
    const roleQuery = `
        SELECT 
            role_id,
            role_name,
            role_description
        FROM admin_role
        WHERE role_id IN (?)
            AND deleted_at IS NULL
        ORDER BY role_name
    `;
    
    const roles = await mysqlQueryRunner.runQueryInMaster(roleQuery, [roleIds]);
    const roleMap = {};
    roles.forEach(role => {
        roleMap[role.role_id] = {
            role_id: role.role_id,
            role_name: role.role_name,
            role_description: role.role_description
        };
    });
    
    // Step 4: Group roles by user_id
    const rolesByUser = {};
    userRoles.forEach(userRole => {
        if (!rolesByUser[userRole.user_id]) {
            rolesByUser[userRole.user_id] = [];
        }
        if (roleMap[userRole.role_id]) {
            rolesByUser[userRole.user_id].push(roleMap[userRole.role_id]);
        }
    });
    
    // Step 5: Return array of objects with user_id and roles (include users with no roles)
    return userIds.map(userId => ({
        user_id: userId,
        roles: rolesByUser[userId] || []
    }));
};

/**
 * Update roles for a user
 * @param {string} userId - User ID
 * @param {Array<string>} roleIds - Array of role IDs to assign
 * @returns {Promise<number>} Number of roles assigned
 */
exports.updateUserRoles = async function(userId, roleIds) {
    // Step 1: Soft delete all existing roles for this user
    const deleteQuery = `
        UPDATE admin_user_role 
        SET deleted_at = NOW() 
        WHERE user_id = ? AND deleted_at IS NULL
    `;
    await mysqlQueryRunner.runQueryInMaster(deleteQuery, [userId]);
    
    // Step 2: Insert new roles
    if (roleIds && roleIds.length > 0) {
        const insertQuery = `
            INSERT INTO admin_user_role (admin_user_role_id, role_id, user_id) 
            VALUES ?
        `;
        
        const insertData = roleIds.map(roleId => [
            cuid(), // Generate CUID for admin_user_role_id
            roleId,
            userId
        ]);
        
        await mysqlQueryRunner.runQueryInMaster(insertQuery, [insertData]);
    }
    
    return roleIds ? roleIds.length : 0;
};
