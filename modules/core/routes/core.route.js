'use strict';
var config = require('../../../config/config');
var versionConfig = require('../../version');


module.exports = function (app) {

  app.route(versionConfig.routePrefix).get(function (req, res) {

    res.json({
      message: config.app.title + " " + req.t('SERVER_IS_RUNNING')
    });
  });

};
