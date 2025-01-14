var mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.getUserDataByUserIds = async (userIds) => {
    const query = `
        SELECT 
            u.user_id,
            u.display_name,
            u.username,
            u.user_id,
            u.profile_pic,
            u.is_verified,
            u.total_followers
        FROM
            user as u
        WHERE 
            u.user_id IN (?)
    `;

    return await mysqlQueryRunner.runQueryInSlave(query, [userIds]);
};
