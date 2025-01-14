const kafkaCtrl = require('./kafka.controller');
const config = require('../../../config/config');


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
    const messages = [{ value: JSON.stringify(activityLogObj) }];

    kafkaCtrl.sendMessage(
        config.kafka.topicNames.adminEventsTopic,
        messages
    );

    return 1;
}
