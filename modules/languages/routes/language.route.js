'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const LanguageCtrl = require('../controllers/language.controller');
const LanguageValidator = require('../validators/language.validator');

module.exports = function (app) {
  app.route(
    versionConfig.routePrefix + '/languages'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    LanguageCtrl.listLanguages
  );

  app.route(
    versionConfig.routePrefix + '/languages'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    LanguageValidator.validateCreateLanguageData,
    LanguageCtrl.createLanguage
  );

  app.route(
    versionConfig.routePrefix + '/languages/:languageId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    LanguageCtrl.getLanguage
  );

  app.route(
    versionConfig.routePrefix + '/languages/:languageId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    LanguageValidator.validateUpdateLanguageData,
    LanguageCtrl.updateLanguage
  );

  app.route(
    versionConfig.routePrefix + '/languages/:languageId/status'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    LanguageValidator.validateUpdateLanguageStatus,
    LanguageCtrl.updateLanguageStatus
  );

  app.route(
    versionConfig.routePrefix + '/languages/:languageId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    LanguageCtrl.archiveLanguage
  );
};
