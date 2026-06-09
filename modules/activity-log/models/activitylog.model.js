var mysqlQueryRunner = require('../../core/models/mysql.promise.model');
var {
    runQueryingInMaster: RunCHQueryingInMaster
} = require('../../core/models/clickhouse.promise.model');


exports.getAllLogs = async function(offset, limit, options, filters = {}) {
    const selectColumns = "aa_log_id, admin_user_id, entity_type, action_name, entity_id, additional_data, action_description, created_at";
    let query = `SELECT ${selectColumns} FROM admin_activity_log`;
    const values = [];
    const conditions = [];

    if (filters.entityType) {
        conditions.push('entity_type = ?');
        values.push(filters.entityType);
    }

    if (filters.entityId) {
        conditions.push('entity_id = ?');
        values.push(filters.entityId);
    }

    if (conditions.length) {
        query += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (options && options.order) {
        query += ` ORDER BY ${options.order[0]} ${options.order[1]} LIMIT ?, ?`;
        values.push(offset, limit);
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

exports.getCollectionDetailsByIds = async function(collectionIds) {
    const query = `
        SELECT 
            collection_id,
            collection_name,
            thumbnail_cf_r2_key,
            thumbnail_cf_r2_url,
            additional_data,
            created_at
        FROM collections 
        WHERE collection_id IN (?)
    `;
    const values = [collectionIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getExploreSectionDetailsByIds = async function(sectionIds) {
    const query = `
        SELECT 
            section_id,
            section_name,
            layout_type,
            sort_order,
            status,
            additional_data,
            created_at,
            updated_at
        FROM explore_sections 
        WHERE section_id IN (?)
    `;
    const values = [sectionIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getExploreSectionItemDetailsByIds = async function(itemIds) {
    const query = `
        SELECT 
            explore_section_item_id,
            section_id,
            resource_type,
            resource_id,
            sort_order,
            created_at
        FROM explore_section_items 
        WHERE explore_section_item_id IN (?)
    `;
    const values = [itemIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getPackDetailsByIds = async function(packIds) {
    const query = `
        SELECT 
            pack_id,
            pack_name,
            thumbnail_cf_r2_key,
            thumbnail_cf_r2_url,
            additional_data,
            language_code,
            credits,
            alacarte_price,
            alacarte_original_price,
            created_at
        FROM packs 
        WHERE pack_id IN (?)
    `;
    const values = [packIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getCharacterDetailsByIds = async function(characterIds) {
    const query = `
        SELECT 
            user_character_id,
            character_name,
            character_type,
            character_gender,
            character_description,
            thumb_cf_r2_key,
            thumb_cf_r2_url,
            trigger_word,
            user_id,
            created_by_admin_id,
            training_status,
            created_at
        FROM user_characters 
        WHERE user_character_id IN (?)
    `;
    const values = [characterIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.getNicheDetailsByIds = async function(nicheIds) {
    const query = `
        SELECT 
            niche_id,
            niche_name,
            slug,
            display_order,
            is_active,
            created_at,
            updated_at
        FROM template_niches 
        WHERE niche_id IN (?)
    `;
    const values = [nicheIds];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
};
