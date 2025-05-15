'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const CharacterMediaCtrl = require('../controllers/media.character.controller');
const CharacterMediaValidator = require('../validators/media.character.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/characters/:characterId/media'
  ).post(
    AuthMiddleware.isAdminUser,
    CharacterMediaValidator.validateUploadMediaToCharacter,
    CharacterMediaCtrl.uploadMediaToCharacter
  );

  app.route(
    versionConfig.routePrefix + '/characters/:characterId/media'
  ).get(
    AuthMiddleware.isAdminUser,
    CharacterMediaCtrl.listCharacterMedia
  );
}; 