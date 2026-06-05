'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const JourneyStageCtrl = require('../controllers/journey.stage.controller');

module.exports = function (app) {
  app.route(versionConfig.routePrefix + '/journey-stages')
    .get(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.listJourneyStages)
    .post(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.createJourneyStage)
    .patch(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.reorderJourneyStages);

  app.route(versionConfig.routePrefix + '/journey-stages/:stageId')
    .patch(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.updateJourneyStage)
    .delete(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.archiveJourneyStage);

  app.route(versionConfig.routePrefix + '/templates/journey-stages')
    .patch(AuthMiddleware.isAuthorizedJWT, JourneyStageCtrl.bulkAssignJourneyStage);
};
