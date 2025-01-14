const env = process.env.NODE_ENV || 'dev';

const loggerConfig = {
  dev: {
    console: true,
    file: true,
    level: 'debug'
  },
  local: {
    console: true,
    file: true,
    level: 'info'
  },
  staging: {
    console: true,
    file: true,
    level: 'info'
  },
  prod: {
    console: false,
    file: true,
    level: 'error'
  }
};

const config = loggerConfig[env] || loggerConfig.dev;

module.exports = config; 