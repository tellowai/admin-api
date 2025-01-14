'use strict';
// 'modules/!(core)/routes/**/*.js', 
module.exports = {
  server: {
    models: 'modules/*/models/**/*.js',
    mongooseModels: 'modules/*/models/**/*.js',
    routes: ['modules/*/routes/**/*.js'],
    config: 'modules/*/config/*.js',
    locales: 'config/locales/*/*.json',
    passportStrategies: ['modules/auth/controllers/passport/strategies/*.js']
  }
};
