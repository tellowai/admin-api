var config = require('../../../config/config');
var chalk = require("chalk");
var neo4jQueryRunner = require('../../core/models/neo4j.model');


exports.registerUserNodeOnGraphDb = function (userDataObj, next) {

    var query = "MERGE (u:USER {id: $userId}) RETURN u;";
    var data = {
        userId : userDataObj.registeredUserObj.user_id
    }

    neo4jQueryRunner.runNeo4jQuery(query, data, function (err, resp) {

        if(err) {
      
            return next(err);
        }
          
        return next(err, resp);
    });
};
  