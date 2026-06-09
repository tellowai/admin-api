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

exports.findUserIdByOrderId = async function (orderId) {
    const rows = await mysqlQueryRunner.runQueryInSlave(
        'SELECT user_id FROM orders WHERE order_id = ? LIMIT 1',
        [orderId]
    );
    return rows && rows[0] ? rows[0].user_id : null;
};

exports.getEndUserSnapshotByUserId = async function (userId) {
    const rows = await mysqlQueryRunner.runQueryInSlave(
        `SELECT user_id, email, first_name, last_name, mobile, display_name, profile_pic, profile_pic_bucket, profile_pic_asset_key
         FROM user WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`,
        [userId]
    );
    return rows && rows[0] ? rows[0] : null;
};

/** Lightweight row for admin user hover previews. */
exports.getEndUserHoverCardByUserId = async function (userId) {
    const rows = await mysqlQueryRunner.runQueryInSlave(
        `SELECT user_id, email, first_name, last_name, mobile, display_name,
                profile_pic, profile_pic_bucket, profile_pic_asset_key, created_at
         FROM user WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`,
        [userId]
    );
    return rows && rows[0] ? rows[0] : null;
};

exports.countCompletedOrdersByUserId = async function (userId) {
    const rows = await mysqlQueryRunner.runQueryInSlave(
        `SELECT COUNT(*) AS cnt FROM orders WHERE user_id = ? AND status = 'completed'`,
        [userId]
    );
    return rows && rows[0] ? Number(rows[0].cnt) || 0 : 0;
};

/**
 * Support mobile lookup: compares digits-only form (handles +91 / spaces), substring on raw mobile,
 * exact trailing digit match, and national number match after a leading 91 country code.
 */
exports.lookupEndUsersByMobile = async function (rawMobile, limit) {
    const cap = typeof limit === 'number' && limit > 0 ? limit : 3;
    const rawTrim = String(rawMobile || '').trim();
    const digitsQuery = rawTrim.replace(/\D/g, '');
    if (!digitsQuery) return [];

    const escapeLike = (s) =>
        String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rawPattern = `%${escapeLike(rawTrim)}%`;
    const digitsPattern = `%${digitsQuery}%`;
    const natPattern = `%${digitsQuery}%`;
    const dlen = digitsQuery.length;

    const mdExpr = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile,''),'+',''),'-',''),' ',''),'(',''),')','')`;

    const sql = `
SELECT u.user_id, u.email, u.first_name, u.last_name, u.mobile, u.display_name, u.profile_pic, u.profile_pic_bucket, u.profile_pic_asset_key
FROM (
  SELECT user_id, email, first_name, last_name, mobile, display_name, profile_pic, profile_pic_bucket, profile_pic_asset_key, created_at,
    ${mdExpr} AS md
  FROM user
  WHERE deleted_at IS NULL AND mobile IS NOT NULL AND TRIM(mobile) <> ''
) u
WHERE u.mobile LIKE ?
   OR u.md LIKE ?
   OR ( ? BETWEEN 7 AND 15 AND RIGHT(u.md, ?) = ? )
   OR ( ? >= 6 AND u.md LIKE '91%' AND CHAR_LENGTH(u.md) >= 12 AND SUBSTRING(u.md, 3) LIKE ? )
ORDER BY (u.md = ?) DESC, (RIGHT(u.md, ?) = ?) DESC, (u.mobile = ?) DESC, u.created_at DESC
LIMIT ?
`;

    const params = [
        rawPattern,
        digitsPattern,
        dlen,
        dlen,
        digitsQuery,
        dlen,
        natPattern,
        digitsQuery,
        dlen,
        digitsQuery,
        rawTrim,
        cap
    ];

    return await mysqlQueryRunner.runQueryInMaster(sql, params);
};

/**
 * Broader consumer search for admin "create support ticket" (multiple rows; pick one in UI).
 * @param {'mobile'|'name'} type
 * @param {string} rawQ
 * @param {number} [limit]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
exports.searchEndUsersForSupportTicket = async function (type, rawQ, limit) {
  const cap =
    typeof limit === 'number' && limit > 0 ? Math.min(Math.max(limit, 1), 50) : 25;
  const t = String(type || 'mobile').toLowerCase();

  if (t === 'mobile') {
    return await exports.lookupEndUsersByMobile(rawQ, cap);
  }

  const q = String(rawQ || '').trim();
  if (q.length < 2) {
    return [];
  }

  const escapeLike = (s) =>
    String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${escapeLike(q)}%`;

  if (t === 'name') {
    const sql = `
      SELECT user_id, email, first_name, last_name, mobile, display_name, profile_pic, profile_pic_bucket, profile_pic_asset_key
      FROM user
      WHERE deleted_at IS NULL
        AND (
          display_name LIKE ?
          OR first_name LIKE ?
          OR last_name LIKE ?
          OR CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) LIKE ?
        )
      ORDER BY display_name ASC, user_id ASC
      LIMIT ?
    `;
    return await mysqlQueryRunner.runQueryInSlave(sql, [pattern, pattern, pattern, pattern, cap]);
  }

  return [];
};

/** Completed guest orders keyed by device_id. */
exports.countCompletedOrdersByDeviceIds = async function (deviceIds) {
  const ids = [...new Set((deviceIds || []).filter((id) => id != null && String(id).trim() !== '').map((id) => String(id)))];
  const map = new Map();
  if (!ids.length) return map;

  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT device_id, COUNT(*) AS cnt
     FROM orders
     WHERE device_id IN (?) AND user_id IS NULL AND status = 'completed'
     GROUP BY device_id`,
    [ids]
  );

  for (const r of rows || []) {
    map.set(String(r.device_id), Number(r.cnt) || 0);
  }
  return map;
};

/** First / last order timestamps for guest device anchors. */
exports.getGuestDeviceOrderBoundsByDeviceIds = async function (deviceIds) {
  const ids = [...new Set((deviceIds || []).filter((id) => id != null && String(id).trim() !== '').map((id) => String(id)))];
  const map = new Map();
  if (!ids.length) return map;

  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT device_id,
            MIN(created_at) AS first_order_at,
            MAX(created_at) AS last_order_at,
            COUNT(*) AS order_count
     FROM orders
     WHERE device_id IN (?) AND user_id IS NULL
     GROUP BY device_id`,
    [ids]
  );

  for (const r of rows || []) {
    map.set(String(r.device_id), {
      first_order_at: r.first_order_at || null,
      last_order_at: r.last_order_at || null,
      order_count: Number(r.order_count) || 0
    });
  }
  return map;
};

/** Latest guest subscription row for a device (pre-sign-in mobile checkout). */
exports.getGuestDeviceSubscriptionByDeviceId = async function (deviceId) {
  const did = String(deviceId || '').trim();
  if (!did) return null;

  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT subscription_id, status, provider_plan_id, start_at, claimed_at, created_at
     FROM subscriptions
     WHERE device_id = ? AND user_id IS NULL
     ORDER BY COALESCE(start_at, created_at) DESC
     LIMIT 1`,
    [did]
  );
  return rows && rows[0] ? rows[0] : null;
};
