'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TemplateFacetCtrl = require('../controllers/template.facet.controller');

module.exports = function(app) {
  // List all facets with their tags
  app.route(
    versionConfig.routePrefix + '/template-facets'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateFacetCtrl.listTemplateFacetsWithTags
  );

  // List tags for a specific facet with pagination
  app.route(
    versionConfig.routePrefix + '/template-facets/:facetName/tags'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateFacetCtrl.listTemplateFacetTags
  );
};
