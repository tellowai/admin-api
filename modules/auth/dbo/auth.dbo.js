var slaveConnection = require("../../../config/lib/mysql").slaveConn;
var masterConnection = require("../../../config/lib/mysql").masterConn;
var adminDebug = require('../utils/adminDebugStdout');
var HTTP_STATUS_CODES =
  require("../../core/controllers/httpcodes.server.controller").CODES;
var CUSTOM_ERROR_CODES =
  require("../../core/controllers/customerrorcodes.server.controller").CODES;
var mysqlErrorHandler = require('../../core/controllers/mysqlerrorhandler.server.controller');

var i18next = require("i18next");
var _ = require("lodash");
var chalk = require("chalk");


exports.createPostComment = async function (postId, userId, commentText, commentId) {

  const query = `
        INSERT INTO user_post_comment (upc_id, post_id, user_id, comment_text) 
        VALUES (?, ?, ?, ?);
    `;

  const values = [commentId, postId, userId, commentText];
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.insertId;
};

exports.getUserDataByProviderBackedUserId = function (userIdFromProvider, options, next) {

  if (_.isFunction(options) && !next) {

    // set next value as second param
    // sometimes you don't pass options
    next = options;
    options = {
      select: [`*`],
    };
  }

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    const safeUserId = String(userIdFromProvider).trim();

    connection.query(
      `SELECT ${options.select}  FROM user_authentication_provider WHERE user_id_from_provider = ?`, [
      safeUserId
    ], function (err, rows) {

      if (err) {

        console.error(chalk.red(err));
        connection.release();

        var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

        adminDebug.warn('auth.dbo.getUserDataByProviderBackedUserId:query_err', {
          subTail: safeUserId.slice(-8),
          message: finalErrObj.message
        });

        return next(finalErrObj);
      }

      connection.release();

      adminDebug.log('auth.dbo.getUserDataByProviderBackedUserId:ok', {
        subTail: safeUserId.slice(-8),
        rowCount: rows.length,
        linkedUserIds: rows.map(function (r) { return r.user_id; }),
        providerTypes: rows.map(function (r) { return r.provider_type; })
      });

      return next(null, rows);
    }
    );
  });
};

exports.getUserDataByEmail = function (userEmail, options, next) {

  if (_.isFunction(options) && !next) {

    // set next value as second param
    // sometimes you don't pass options
    next = options;
    options = {
      select: [`*`],
    };
  }

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM user WHERE ?`, [{
        email: userEmail
      }], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

/**
 * Same as getUserDataByEmail but reads from the primary (master) connection.
 * Use for OAuth / login paths where replica lag must not return a false empty set.
 */
exports.getUserDataByEmailFromMaster = function (userEmail, options, next) {

  if (_.isFunction(options) && !next) {

    next = options;
    options = {
      select: [`*`],
    };
  }

  adminDebug.log('auth.dbo.getUserDataByEmailFromMaster:start', { email: userEmail });

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      adminDebug.warn('auth.dbo.getUserDataByEmailFromMaster:conn_err', { email: userEmail, message: connErr.message });
      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM user WHERE ?`, [{
        email: userEmail
      }], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          adminDebug.warn('auth.dbo.getUserDataByEmailFromMaster:query_err', { email: userEmail, message: finalErrObj.message });
          return next(finalErrObj);
        }

        connection.release();

        adminDebug.log('auth.dbo.getUserDataByEmailFromMaster:ok', {
          email: userEmail,
          rowCount: rows.length,
          userIds: rows.map(function (r) { return r.user_id; })
        });

        return next(null, rows);
      }
    );
  });
};

exports.registerDevice = function (deviceData, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "INSERT INTO login_device SET ?", deviceData, function (err, rows) {

        if (err) {

          // console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

exports.getDataIfDeviceExists = function (deviceData, next) {

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "SELECT login_device_id FROM login_device WHERE brand = ? AND model = ? LIMIT 1", [
      deviceData.brand,
      deviceData.model
    ], function (err, rows) {

      if (err) {

        console.error(chalk.red(err));
        connection.release();

        var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

        return next(finalErrObj);
      }

      connection.release();

      return next(null, rows[0]);
    }
    );
  });
};

exports.saveUserLoggedInDevice = function (deviceData, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "INSERT INTO user_login_device SET ? ",
      deviceData, function (err, rows) {

        if (err) {

          // console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

exports.getDataIfUserLoggedInDeviceExists = function (userLoggedInDeviceData, next) {

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "SELECT user_login_device_id FROM user_login_device " +
      "WHERE login_device_id = ? AND user_id = ? AND os = ? AND os_version = ? LIMIT 1", [
      userLoggedInDeviceData.login_device_id,
      userLoggedInDeviceData.user_id,
      userLoggedInDeviceData.os,
      userLoggedInDeviceData.os_version
    ], function (err, rows) {

      if (err) {

        console.error(chalk.red(err));
        connection.release();

        var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

        return next(finalErrObj);
      }

      connection.release();

      return next(null, rows[0]);
    }
    );
  });
};

exports.updateLogggedInDeviceLastLogin = function (updateUserDeviceData, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "UPDATE user_login_device SET ? ",
      updateUserDeviceData,
      function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

exports.insertLoginHistory = function (userLoginHistory, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      "INSERT INTO user_login_history SET ? ",
      userLoginHistory, function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

exports.getUserDataByMobile = function (userMobile, options, next) {

  if (_.isFunction(options) && !next) {

    // set next value as second param
    // sometimes you don't pass options
    next = options;
    options = {
      select: [`*`],
    };
  }

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {

      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if (connection) {

        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM user WHERE ?`, [{
        mobile: userMobile
      }], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();

          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};
