'use strict';
var passport = require('passport');

var versionConfig = require('../../version');
var FacebookOAuthCtrl = require('../controllers/facebook.controller');
var GoogleOAuthCtrl = require('../controllers/google.controller');
var TruecallerAuthCtrl = require('../controllers/truecaller.controller');
var AuthMiddleware = require('../middlewares/auth.middleware');
var TokensCtrl = require('../controllers/tokens.controller');
var UsersCtrl = require('../controllers/user.controller');


module.exports = function (app) {

  // Facebook login with oauth token
  app.route(
    versionConfig.routePrefix +
    "/login/facebook"
  ).get(
    function (req, res) {
      return res.render('facebook-login.html');
    }
  );

  // Google login with oauth token
  app.route(
    versionConfig.routePrefix +
    "/login/google"
  ).get(
    function (req, res) {
      return res.render('google-login.html');
    }
  );

  // Truecaller login with token
  app.route(
    versionConfig.routePrefix +
    "/login/truecaller"
  ).get(
    function (req, res) {
      return res.render('truecaller.html');
    }
  );
  
  // Facebook login oauth urls
  app.route(
    versionConfig.routePrefix +
    "/oauth/facebook"
  ).get(
    passport.authenticate('facebook', { scope : ['email'] })
  );

  app.route(
    versionConfig.routePrefix +
    '/oauth/facebook/callback'
  ).get(
    FacebookOAuthCtrl.loginWithOAuthFacebook
  );

  // Google login oauth urls
  app.route(
    versionConfig.routePrefix +
    "/oauth/google"
  ).get(
    passport.authenticate('google', { scope : ['email', 'profile'] })
  );

  app.route(
    versionConfig.routePrefix +
    '/oauth/google/callback'
  ).get(
    GoogleOAuthCtrl.loginWithOAuthGoogle
  );
  
  // login with truecaller
  app.route(
    versionConfig.routePrefix +
    "/auth/truecaller"
  ).post(
    TruecallerAuthCtrl.loginWithTruecallerToken
  );
  
  // refresh jwt tokenand rotate refresh token
  app.route(
    versionConfig.routePrefix +
    '/refresh/tokens'
  ).post(
    AuthMiddleware.hasRTTokenNRsid,
    TokensCtrl.refreshJwtnRotateRT
  );

  app.route(
    versionConfig.routePrefix +
    '/refresh/tokens/archive'
  ).put(
    AuthMiddleware.hasRTTokenNRsid,
    TokensCtrl.refreshJwtnRotateRT2
  );

  app.route(
    versionConfig.routePrefix +
    '/logout'
  ).get(
    AuthMiddleware.hasRTTokenNRsid,
    TokensCtrl.revokeTokensnLogout
  );

  app.route(
    versionConfig.routePrefix +
    '/me'
  ).get(
    AuthMiddleware.isAdminUser,
    UsersCtrl.getLoggedInUserData
  );
};
