var mysqlQueryRunner = require('../../core/models/mysql.promise.model');


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
    let selectAllQuery = `SELECT user_id, username, email, display_name, profile_pic FROM user WHERE email LIKE '%${email}%' AND DELETED_AT IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [limit, offset]);
};

exports.searchAdminUsersByEmailOrMobile = async function(emailOrmobile, limit, offset, searchType = 'both') {
    let whereClause = '';
    
    if (searchType === 'email') {
        whereClause = `email LIKE '%${emailOrmobile}%'`;
    } else if (searchType === 'mobile') {
        whereClause = `mobile LIKE '%${emailOrmobile}%'`;
    } else {
        // Default: search both email and mobile
        whereClause = `(email LIKE '%${emailOrmobile}%' OR mobile LIKE '%${emailOrmobile}%')`;
    }
    
    let selectAllQuery = `SELECT user_id, email, mobile, display_name, profile_pic FROM user WHERE ${whereClause} AND DELETED_AT IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [limit, offset]);
};

exports.getAdminUsersFromIds = async function(userIds) {
    let selectAllQuery = "SELECT admin_user_role_id, user_id, created_at, updated_at FROM admin_user_role WHERE user_id IN (?) AND DELETED_AT IS NULL";

    return await mysqlQueryRunner.runQueryInMaster(selectAllQuery, [userIds]);
};
