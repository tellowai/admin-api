'use strict';

/**
 * Module dependencies.
 */
var _ = require('lodash');
var glob = require('glob');
var chalk = require('chalk');
var path = require('path');

/**
 * Get files by glob patterns
 */
var getGlobbedFiles = function(globPatterns, removeRoot) {
  // For context switching
  var _this = this;

  // URL paths regex
  var urlRegex = new RegExp('^(?:[a-z]+:)?\/\/', 'i');

  // The output array
  var output = [];

  // If glob pattern is array so we use each pattern in a recursive way, otherwise we use glob
  if (_.isArray(globPatterns)) {
    globPatterns.forEach(function(globPattern) {
      output = _.union(output, getGlobbedFiles(globPattern, removeRoot));
    });
  } else if (_.isString(globPatterns)) {
    if (urlRegex.test(globPatterns)) {
      output.push(globPatterns);
    } else {
      var files = glob.sync(globPatterns);
      if (removeRoot) {
        files = files.map(function(file) {
          return file.replace(removeRoot, '');
        });
      }

      output = _.union(output, files);
    }
  }

  return output;
};

var validateEnvironmentVariable = function () {
  /**
   * Before we begin, lets set the environment variable
   * We'll Look for a valid NODE_ENV variable and if one cannot be found load the development NODE_ENV
   */
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'undefined') {
    console.error(chalk.red('NODE_ENV is not defined! Using default local environment'));
    process.env.NODE_ENV = 'local';
  } else {
    var environmentFiles = glob.sync('./config/env/' + process.env.NODE_ENV + '.js');
    if (environmentFiles.length) {
      console.log(chalk.black.bgWhite('Application loaded using the "' + process.env.NODE_ENV + '" environment configuration'));
    } else {
      console.error(chalk.red('+ Error: No configuration file found for "' + process.env.NODE_ENV + '" environment using development instead'));
      process.env.NODE_ENV = 'development';
    }
  }
};

/**
 * Initialize global configuration files
 */
var initGlobalAppFiles = function (config, assets) {
  // Appending files
  config.files = {
    server: {}
  };

  // Setting Globbed model files
  config.files.server.models = getGlobbedFiles(assets.server.models);

  // Setting Globbed route files
  config.files.server.routes = getGlobbedFiles(assets.server.routes);
  
  // Setting Globbed config files
  config.files.server.configs = getGlobbedFiles(assets.server.config);

  // Setting Globbed local files
  config.files.server.locales = getGlobbedFiles(assets.server.locales);

  // Setting Globbed passport strategies
  config.files.server.passportStrategies = getGlobbedFiles(assets.server.passportStrategies);
};



/**
 * Initialize global configuration
 */
var initGlobalConfig = function () {
  validateEnvironmentVariable();

  var config = _.extend(
    require('./env/all'),
    require('./env/' + process.env.NODE_ENV) || {}
  );

  var assets = require(path.join(process.cwd(), 'config/assets/default'));

  // read package.json for MEAN.JS project information
  var pkg = require(path.resolve('./package.json'));
  config.packageJson = pkg;

  // Initialize global globbed applicaiton files
  initGlobalAppFiles(config, assets);

  // Expose configuration utilities
  config.utils = {
    getGlobbedFiles: getGlobbedFiles
  };

  return config;
};

module.exports = initGlobalConfig();
module.exports.getGlobbedFiles = getGlobbedFiles;
