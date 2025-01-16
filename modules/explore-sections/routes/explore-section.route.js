'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const ExploreSectionCtrl = require('../controllers/explore-section.controller');
const ExploreSectionItemCtrl = require('../controllers/explore-section-item.controller');
const ExploreSectionValidator = require('../validators/explore-section.validator');
const ExploreSectionItemValidator = require('../validators/explore-section-item.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/explore-sections'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionCtrl.listExploreSections
  );
  
  app.route(
    versionConfig.routePrefix + '/explore-sections'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionValidator.validateCreateExploreSectionData,
    ExploreSectionCtrl.createExploreSection
  );

  app.route(
    versionConfig.routePrefix + '/explore-sections/sort-order'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionValidator.validateUpdateSortOrderData,
    ExploreSectionCtrl.updateSortOrder
  );

  app.route(
    versionConfig.routePrefix + '/explore-sections/:sectionId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionValidator.validateUpdateExploreSectionData,
    ExploreSectionCtrl.updateExploreSection
  );

  app.route(
    versionConfig.routePrefix + '/explore-sections/:sectionId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionCtrl.archiveExploreSection
  );

  // Section items routes
  app.route(
    versionConfig.routePrefix + '/explore-sections/:sectionId/items'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionItemCtrl.listSectionItems
  );

  app.route(
    versionConfig.routePrefix + '/explore-sections/:sectionId/items'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionItemValidator.validateAddSectionItemsData,
    ExploreSectionItemCtrl.addSectionItems
  );

  app.route(
    versionConfig.routePrefix + '/explore-sections/:sectionId/items'
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    ExploreSectionItemValidator.validateRemoveSectionItemsData,
    ExploreSectionItemCtrl.removeSectionItems
  );
}; 