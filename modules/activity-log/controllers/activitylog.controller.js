'use strict';
const ActivitylogDbo = require('../models/activitylog.model');
const ActivityLogErrorHandler = require('../middlewares/activitylog.error.handler');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const config = require('../../../config/config');


exports.getAllLogs = async function (req, res) {
  const page = req.query.page ? (parseInt(req.query.page) > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
  const limit = req.query.limit ? (parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
  const offset = (page - 1) * limit;
  const orderby = req.query.orderby ? req.query.orderby : 'DESC';

  const filterBy = req.query.module ? req.query.module : null;

  try {
    const allLogs = await ActivitylogDbo.getAllLogs(offset, limit, { order: ['created_at', orderby] }, filterBy);

    if (allLogs.length) {
      const userIds = allLogs.map(log => log.admin_user_id);
      
      const adminUserEntityIds = allLogs
        .filter(log => log.entity_type === 'ADMIN_USER')
        .map(log => log.entity_id);

      const templateEntityIds = allLogs
        .filter(log => log.entity_type === 'TEMPLATES')
        .map(log => log.entity_id);

      const collectionEntityIds = allLogs
        .filter(log => log.entity_type === 'COLLECTIONS')
        .map(log => log.entity_id);

      const exploreSectionEntityIds = allLogs
        .filter(log => log.entity_type === 'EXPLORE_SECTIONS')
        .map(log => log.entity_id);

      const exploreSectionItemEntityIds = allLogs
        .filter(log => log.entity_type === 'EXPLORE_SECTION_ITEMS')
        .map(log => log.entity_id);
      
      const allUserIds = [...new Set([...userIds, ...adminUserEntityIds])];
      
      let userDetailsArr = [];
      let templateDetailsArr = [];
      let collectionDetailsArr = [];
      let exploreSectionDetailsArr = [];
      let exploreSectionItemDetailsArr = [];

      if (allUserIds.length > 0) {
        userDetailsArr = await ActivitylogDbo.getUserDetailsByIds(allUserIds);
      }

      if (templateEntityIds.length > 0) {
        templateDetailsArr = await ActivitylogDbo.getTemplateDetailsByIds(templateEntityIds);
      }

      if (collectionEntityIds.length > 0) {
        collectionDetailsArr = await ActivitylogDbo.getCollectionDetailsByIds(collectionEntityIds);
      }

      if (exploreSectionEntityIds.length > 0) {
        exploreSectionDetailsArr = await ActivitylogDbo.getExploreSectionDetailsByIds(exploreSectionEntityIds);
      }

      if (exploreSectionItemEntityIds.length > 0) {
        exploreSectionItemDetailsArr = await ActivitylogDbo.getExploreSectionItemDetailsByIds(exploreSectionItemEntityIds);
      }
      console.log('userDetailsArr:', userDetailsArr);
      console.log('templateDetailsArr:', templateDetailsArr);
      console.log(collectionEntityIds, 'collectionDetailsArr:', collectionDetailsArr);
      console.log('exploreSectionDetailsArr:', exploreSectionDetailsArr);
      console.log('exploreSectionItemDetailsArr:', exploreSectionItemDetailsArr);
      allLogs.forEach(log => {
        const userDetails = userDetailsArr.find(user => user.user_id == log.admin_user_id);
        if (userDetails) {
          log.user = userDetails;
        }
        
        if (log.entity_type === 'ADMIN_USER') {
          const adminUser = userDetailsArr.find(user => user.user_id == log.entity_id);
          if (adminUser) {
            log.adminUser = adminUser;
          }
        }

        if (log.entity_type === 'TEMPLATES') {
          const template = templateDetailsArr.find(template => template.template_id == log.entity_id);
          if (template) {
            log.template = template;
          }
        }

        if (log.entity_type === 'COLLECTIONS') {
          const collection = collectionDetailsArr.find(collection => collection.collection_id == log.entity_id);
          if (collection) {
            log.collection = collection;
          }
        }

        if (log.entity_type === 'EXPLORE_SECTIONS') {
          const exploreSection = exploreSectionDetailsArr.find(section => section.explore_section_id == log.entity_id);
          if (exploreSection) {
            log.exploreSection = exploreSection;
          }
        }

        if (log.entity_type === 'EXPLORE_SECTION_ITEMS') {
          const exploreSectionItem = exploreSectionItemDetailsArr.find(item => item.explore_section_item_id == log.entity_id);
          if (exploreSectionItem) {
            log.exploreSectionItem = exploreSectionItem;
          }
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: allLogs
    });
  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: req.t('activitylog:ACTIVITYLOG_RETRIEVAL_FAILED')
    };

    return ActivityLogErrorHandler.handleFetchAllLogsErrors(err, res);
  }
}
