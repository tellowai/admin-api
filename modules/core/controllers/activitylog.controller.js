const kafkaCtrl = require('./kafka.controller');
const { TOPICS } = require('../constants/kafka.events.config');


exports.publishNewAdminActivityLog = async function (data) {
    const { adminUserId, entityType, actionName, entityId, additionalData } = data;
    
    // publish an event to kafka - activitylog
    const activityLogObj = {
        action: 'admin_activity_log',
        admin_user_id: adminUserId,
        entity_type: entityType,
        entity_id: entityId,
        action_name: actionName,
        additional_data: additionalData
    };
    const messages = [{ value: activityLogObj }];

    await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        messages,
        'create_admin_activity_log'
    );

    return 1;
}
