var mysqlQueryRunner = require('../../core/models/mysql.promise.model');


exports.createOrUpdateRemoteConfig = async function(newRemoteConfigData) {
    const query = `
        INSERT INTO remote_config (rc_key_name, data_type, rc_default_value, rc_value)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        data_type = VALUES(data_type),
        rc_default_value = VALUES(rc_default_value),
        rc_value = VALUES(rc_value)`;

    const values = [
        newRemoteConfigData.rc_key_name,
        newRemoteConfigData.data_type,
        newRemoteConfigData.rc_default_value,
        newRemoteConfigData.rc_value
    ];

    const remoteConfigQueryResponse = await mysqlQueryRunner.runQueryInMaster(query, values);
    return remoteConfigQueryResponse.insertId || remoteConfigQueryResponse.affectedRows;
};

exports.getAllRemoteConfigKeysAndDefaultValues = async function() {
    const query = `SELECT rc_key_id, rc_key_name, data_type, rc_value, created_at, updated_at 
        FROM remote_config WHERE archived_at IS NULL ORDER BY updated_at DESC`;
    const values = [];

    return await mysqlQueryRunner.runQueryInSlave(query, values);
};
