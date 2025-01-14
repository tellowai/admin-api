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
        console.log(`offset: ${offset}, limit: ${limit}`);
        const allLogs = await ActivitylogDbo.getAllLogs(offset, limit, { order: ['created_at', orderby] }, filterBy);

        if(allLogs.length) {
            const userIds = allLogs.map(log => log.admin_user_id);
            const userDetailsArr = await ActivitylogDbo.getUserDetailsByIds(userIds);

            allLogs.forEach(log => {
                const userDetails = userDetailsArr.find(user => user.user_id === log.admin_user_id);
                if (userDetails) {
                    log.user = userDetails;
                }
            });
        }

        return res.status(HTTP_STATUS_CODES.OK)
            .json({
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
