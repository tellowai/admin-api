const rateLimiterModel = require('../models/ratelimiter.model');

const storeActionState = async (userId, actionName) => {
    return await rateLimiterModel.storeState(userId, actionName);
};

const getActionCountInWindow = async (userId, actionName, windowType) => {
    return await rateLimiterModel.getActionCountInWindow(userId, actionName, windowType);
};

module.exports = {
    storeActionState,
    getActionCountInWindow
};
