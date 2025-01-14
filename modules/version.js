var config = require('../config/config');
var express = require('express');
const router = express.Router();

var apiVersionV1 = config.apiVersions.v1;
var routePrefixV1 = (apiVersionV1.prefix) ? 
  '/' + apiVersionV1.prefix : 
  '';

exports.router = router;
exports.routePrefix = routePrefixV1;
