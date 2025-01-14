const mongoose = require('mongoose');
const chalk = require('chalk');

const mongoErrorHandler = {
    handleMongoConnErrors: function(err) {
        console.error(chalk.red('MongoDB connection error:', err));
        return {
            message: 'Database connection error',
            error: err
        };
    },
    handleMongoQueryErrors: function(err) {
        console.error(chalk.red('MongoDB query error:', err));
        return {
            message: 'Database query error',
            error: err
        };
    }
};

exports.runQuery = function(operation, model, query, data) {
    return new Promise((resolve, reject) => {
        mongoose.connect(mongoose.connection.url, mongoose.connection.options)
            .then(() => {
                let dbOperation;
                switch(operation) {
                    case 'find':
                        dbOperation = model.find(query);
                        break;
                    case 'findOne':
                        dbOperation = model.findOne(query);
                        break;
                    case 'create':
                        dbOperation = model.create(data);
                        break;
                    case 'update':
                        dbOperation = model.updateOne(query, data);
                        break;
                    case 'delete':
                        dbOperation = model.deleteOne(query);
                        break;
                    default:
                        throw new Error('Invalid operation');
                }
                return dbOperation;
            })
            .then(result => {
                mongoose.connection.close();
                resolve(result);
            })
            .catch(err => {
                mongoose.connection.close();
                const finalErrObj = mongoErrorHandler.handleMongoQueryErrors(err);
                reject(finalErrObj);
            });
    });
};
