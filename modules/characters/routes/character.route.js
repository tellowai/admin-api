'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const CharacterCtrl = require('../controllers/character.controller');
const CharacterValidator = require('../validators/character.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/characters'
  ).post(
    AuthMiddleware.isAdminUser,
    CharacterValidator.validateCreateUserCharacter,
    CharacterCtrl.createUserCharacter
  );

  app.route(
    versionConfig.routePrefix + '/characters'
  ).get(
    AuthMiddleware.isAdminUser,
    CharacterCtrl.listUserCharacters
  );

  app.route(
    versionConfig.routePrefix + '/characters/all'
  ).get(
    AuthMiddleware.isAdminUser,
    CharacterCtrl.listAllUserCharacters
  );

  app.route(
    versionConfig.routePrefix + '/characters/manual'
  ).post(
    AuthMiddleware.isAdminUser,
    CharacterValidator.validateCreateManualCharacter,
    CharacterCtrl.createManualCharacter
  );

  app.route(
    versionConfig.routePrefix + '/characters/:characterId'
  ).patch(
    AuthMiddleware.isAdminUser,
    CharacterValidator.validateUpdateUserCharacter,
    CharacterCtrl.updateUserCharacter
  );

  app.route(
    versionConfig.routePrefix + '/characters/:characterId'
  ).get(
    AuthMiddleware.isAdminUser,
    CharacterCtrl.getUserCharacter
  );
};