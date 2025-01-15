var mysqlQueryRunner = require('../../core/models/mysql.promise.model');
var {
    runQueryingInMaster: RunCHQueryingInMaster
} = require('../../core/models/clickhouse.promise.model');


exports.getAllLogs = async function(offset, limit, options, filterBy) {
    const selectColumns = "aa_log_id, admin_user_id, entity_type, action_name, entity_id, additional_data, action_description, created_at";
    let query = `SELECT ${selectColumns} FROM admin_activity_log`;
    const values = [offset, limit];

    if (filterBy) {
        query += ` AND entity_type = ?`;
        values.push(filterBy);
    }

    if (options && options.order) {
        query += ` ORDER BY ${options.order[0]} ${options.order[1]} LIMIT ?, ?`;
    }

    return await mysqlQueryRunner.runQueryInSlave(query, values);
};

exports.getUserDetailsByIds = async function(userIds) {
    const query = `SELECT user_id, display_name, first_name, middle_name, last_name, email, profile_pic, deleted_at from user WHERE user_id IN (?)`;
    const values = [
        userIds
    ];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};
exports.getTemplateDetailsByIds = async function(templateIds) {
    const query = `SELECT template_id, template_name FROM templates WHERE template_id IN (?)`;
    const values = [
        templateIds
    ];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};
