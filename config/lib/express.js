var express = require('express');
var compress = require('compression');
var cookieParser = require('cookie-parser');
var path = require('path');
var helmet = require('helmet');
var cors = require('cors');
var i18next = require('i18next');
var i18nextMiddleware = require('i18next-http-middleware');
const i18nextBackend = require('i18next-fs-backend')
var config = require('../config');
var passport = require('passport');
var session = require('express-session');
const multer = require('multer');


/**
 * Initialize application middleware
 */
module.exports.initMiddleware = function (app) {
  // Showing stack errors
  app.set('showStackError', true);

  app.use(express.urlencoded({
    extended: true,
    limit: '50mb' // Increased from default 100kb to 50mb
  }));
  app.use(express.json({
    limit: '50mb' // Increased from default 100kb to 50mb
  }));

  // Global multer error handler
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).send({
          message: 'Unexpected field in form data'
        });
      }
    }

    next(err);
  });

  // Add the cookie parser and flash middleware
  app.use(cookieParser());

  app.use(i18nextMiddleware.handle(i18next));

  // Authentication configuration
  app.use(session({
    resave: false,
    saveUninitialized: true,
    secret: config.redis.sessionSecret
  }));

  // Initialize Passport and restore authentication state, if any, from the
  // session.
  app.use(passport.initialize());
  app.use(passport.session());
};


/**
 * Invoke modules server configuration
 */
module.exports.initModulesConfiguration = function (app) {
  config.files.server.configs.forEach(function (configPath) {
    require(path.resolve(configPath))(app);
  });
};

// Load the mongoose models
module.exports.loadModels = function () {

  // Globbing model files
  config.files.server.models.forEach(function (modelPath) {
    require(path.resolve(modelPath));
  });
};

/**
 * Configure the modules server routes
 */
module.exports.initModulesServerRoutes = function (app) {

  // Globbing routing files
  config.files.server.routes.forEach(function (routePath) {

    require(path.resolve(routePath))(app);
  });
};

/**
 * Configure passport module
 */
module.exports.initPassportWStrategies = function (app) {

  // Globbing routing files
  config.files.server.passportStrategies.forEach(function (routePath) {

    require(path.resolve(routePath))(app);
  });
};

/**
 * Configure the modules server locales
 */
module.exports.initModulesServerLocales = function (app) {

  var i18Namespaces = ['common'];

  // get namespaces from path
  config.files.server.locales.forEach(function (fullPath) {
    var filename = fullPath.replace(/^.*[\\\/]/, '');
    var filenameWoExtension = filename.split('.').slice(0, -1).join('.');

    if (i18Namespaces.indexOf(filenameWoExtension) < 0) {
      i18Namespaces.push(filenameWoExtension);
    }
  });

  i18next
    .use(i18nextBackend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
      detection: {
        order: ['querystring', 'header'],
        lookupQuerystring: 'locale'
      },
      fallbackLng: 'en',
      ns: i18Namespaces,
      defaultNS: 'common',
      backend: {
        loadPath: 'config/locales/{{lng}}/{{ns}}.json'
      }
    });
};

/**
 * Configure Helmet headers configuration
 */
module.exports.initHelmetHeaders = function (app) {
  // Use helmet to secure Express headers
  app.use(
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://firebaseinstallations.googleapis.com', 'https://fcmregistrations.googleapis.com', 'https://connect.facebook.net', 'https://www.facebook.com', 'https://graph.facebook.com'], // Add Facebook Graph API domain
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://firebaseinstallations.googleapis.com', 'https://www.gstatic.com', 'https://apis.google.com', 'https://accounts.google.com', 'https://connect.facebook.net', "'unsafe-eval'"],
        frameSrc: ["'self'", 'https://accounts.google.com', 'https://connect.facebook.net', 'https://www.facebook.com'], // Add Facebook's domain
        imgSrc: ["'self'", 'data:', 'https://www.facebook.com'], // Allow images from self, data URIs, and Facebook's domain
        // Add other directives as needed
      },
    })
  );
  app.disable('x-powered-by');
};

/**
 * Configure Cors module to allow specific domains
 */
module.exports.handleCors = function (app) {
  var whitelist = [
    'http://localhost:8010',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://localhost:8005',
    'https://dev.photobop.co',
    'https://dev-admin.photobop.co',
    'https://www.photobop.co',
    'https://photobop.co',
    'https://tellowai.com',
    'https://admin.tellowai.com',
    'https://admin.pifield.com',
    'https://pifield.com',
  ];
  var corsOptions = {
    origin: function (origin, callback) {
      var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
      callback(null, originIsWhitelisted);
    },
    credentials: true
  };

  app.use(cors(corsOptions));
};

/**
 * Initialize the Express application
 */
module.exports.init = function () {
  // Initialize express app
  var app = express();

  // Initialize middlewares
  this.initMiddleware(app);

  // Initialize helmet
  this.initHelmetHeaders(app);

  app.use(express.static(path.join(__dirname + '/../../', 'public')));
  app.set('view engine', 'html');
  app.engine('html', require('ejs').renderFile);


  // Initialize passport module
  this.initPassportWStrategies(app)

  // Enable and handle cors
  this.handleCors(app);

  // Initialize modules server routes
  this.initModulesServerRoutes(app);

  // Initialize modules server locales
  this.initModulesServerLocales(app);

  return app;
};
