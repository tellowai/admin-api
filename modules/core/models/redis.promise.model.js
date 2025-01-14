const redisClient = require("../../../config/lib/redis").redisClient;
const config = require("../../../config/config");

exports.setData = function(key, val, ttl) {
    return new Promise((resolve, reject) => {
        const redisKey = config.redis.projectPrefix + key;
        const value = JSON.stringify(val);
        if (ttl) {
            redisClient.setex(redisKey, ttl, value, function (err, res) {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        } else {
            redisClient.set(redisKey, value, function (err, res) {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        }
    });
}

exports.getData = function(key) {
    return new Promise((resolve, reject) => {
        redisClient.get(
            config.redis.projectPrefix + key, function (err, val) {
            if (err) {
                reject(err);
            } else {
                resolve(JSON.parse(val));
            }
        });
    });
}

exports.deleteData = function(key) {
    return new Promise((resolve, reject) => {
        redisClient.del(
            config.redis.projectPrefix + key,
            function (err, res) {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            }
        );
    });
}

exports.deleteMultipleKeys = function(keys) {
    return new Promise((resolve, reject) => {
        // Map keys to include the project prefix
        const keysToDelete = keys.map(key => config.redis.projectPrefix + key);
        
        // Use the spread operator to pass all keys to the del method
        redisClient.del(...keysToDelete, function (err, res) {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

exports.getMultipleKeysData = function(keys) {
    return new Promise((resolve, reject) => {
        // Map keys to include the project prefix
        const fullKeys = keys.map(key => config.redis.projectPrefix + key);
        
        redisClient.mget(fullKeys, function (err, values) {
            if (err) {
                reject(err);
            } else {
                // Parse each value from JSON before resolving
                const parsedValues = values.map(value => JSON.parse(value));
                resolve(parsedValues);
            }
        });
    });
}

exports.setMultipleKeysData = function(keyValuePairs, ttl) {
    return new Promise((resolve, reject) => {
        const multi = redisClient.multi();
        keyValuePairs.forEach(({ key, value }) => {
            const fullKey = config.redis.projectPrefix + key;
            multi.set(fullKey, JSON.stringify(value), 'EX', ttl);
        });

        multi.exec((err, replies) => {
            if (err) {
                reject(err);
            } else {
                // Convert each reply to a boolean indicating success or failure
                const successReplies = replies.map(reply => reply === 'OK');
                resolve(successReplies);
            }
        });
    });
}
