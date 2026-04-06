var masterConnection = require("../../../config/lib/mysql").masterConn;
var slaveConnection = require("../../../config/lib/mysql").slaveConn;
var adminDebug = require('../utils/adminDebugStdout');
var HTTP_STATUS_CODES =
  require("../../core/controllers/httpcodes.server.controller").CODES;
var CUSTOM_ERROR_CODES =
require("../../core/controllers/customerrorcodes.server.controller").CODES;
var mysqlErrorHandler = require('../../core/controllers/mysqlerrorhandler.server.controller');
var i18next = require("i18next");
var _ = require("lodash");
var chalk = require("chalk");
var mysqlQueryRunner = require('../../core/models/mysql.promise.model');


exports.registerUser = function (userDataObj, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {
        
      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
        "INSERT INTO user SET ?", userDataObj, function (err, rows) {

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

exports.registerUserProvider = function (providerDataObj, next) {

  adminDebug.log('user.dbo.registerUserProvider:attempt', {
    provider_type: providerDataObj && providerDataObj.provider_type,
    user_id: providerDataObj && providerDataObj.user_id,
    user_id_from_provider_tail: providerDataObj && providerDataObj.user_id_from_provider
      ? String(providerDataObj.user_id_from_provider).slice(-8)
      : null
  });

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {
        
      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if(connection) {
        
        connection.release();
      }

      adminDebug.warn('user.dbo.registerUserProvider:conn_err', { message: connErr.message });
      return next(finalErrObj);
    }

    connection.query(
        "INSERT INTO user_authentication_provider SET ?", providerDataObj, function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          adminDebug.warn('user.dbo.registerUserProvider:insert_err', {
            customErrCode: finalErrObj.customErrCode,
            message: finalErrObj.message,
            originalMessage: finalErrObj.originalMessage
          });

          return next(finalErrObj);
        }

        connection.release();

        adminDebug.log('user.dbo.registerUserProvider:insert_ok', {
          user_id: providerDataObj && providerDataObj.user_id
        });

        return next(null, rows);
      }
    );
  });
};

/**
 * Re-point Google login (by `sub`) at the canonical user row — e.g. admin lives on email match, provider was tied to a duplicate user.
 */
exports.updateGoogleProviderUserIdBySub = function (googleSub, userId, next) {
  masterConnection.getConnection(function (connErr, connection) {
    if (connErr) {
      console.error(chalk.red(connErr));
      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);
      if (connection) {
        connection.release();
      }
      return next(finalErrObj);
    }

    var safeSub = String(googleSub).trim();

    connection.query(
      'UPDATE user_authentication_provider SET user_id = ? WHERE user_id_from_provider = ? AND provider_type = ?',
      [userId, safeSub, 'google'],
      function (err, result) {
        if (err) {
          console.error(chalk.red(err));
          connection.release();
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);
          adminDebug.warn('user.dbo.updateGoogleProviderUserIdBySub:query_err', { message: finalErrObj.message });
          return next(finalErrObj);
        }

        connection.release();
        adminDebug.log('user.dbo.updateGoogleProviderUserIdBySub:ok', {
          userId: userId,
          subTail: safeSub.slice(-8),
          affectedRows: result && result.affectedRows,
          changedRows: result && result.changedRows
        });
        return next(null, result);
      }
    );
  });
};

exports.registerSecondaryEmail = function (userDataObj, next) {

  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {
        
      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    adminDebug.log('user.dbo.registerSecondaryEmail:attempt', {
      user_id: userDataObj && userDataObj.user_id,
      email: userDataObj && userDataObj.email
    });

    connection.query(
        "INSERT INTO user_secondary_email SET ?", userDataObj, function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          adminDebug.warn('user.dbo.registerSecondaryEmail:insert_err', {
            email: userDataObj && userDataObj.email,
            customErrCode: finalErrObj.customErrCode,
            originalMessage: finalErrObj.originalMessage
          });

          return next(finalErrObj);
        }

        connection.release();

        adminDebug.log('user.dbo.registerSecondaryEmail:insert_ok', {
          email: userDataObj && userDataObj.email,
          user_id: userDataObj && userDataObj.user_id
        });

        return next(null, rows);
      }
    );
  });
};

exports.getUserEmailAndPwd = function (userEmail, options, next) {
  if (_.isFunction(options) && !next) {
    // set next value as second param
    // sometimes you don't pass options
    next = options;
    options = {
      select: [`*`],
    };
  }

  masterConnection.getConnection(function (connErr, connection) {
    if (connErr) {
      var errMsg = i18next.t("mysql:CONNECTION_ERROR");

      return next({
        message: errMsg,
        httpCode: HTTP_CODES.BAD_REQUEST,
      });
    }

    connection.query(
      `SELECT u.user_id, u.username, u.email, u.password, u.password_salt, u.is_email_verified FROM user as u WHERE u.email = ?`,
      [userEmail],
      function (err, rows) {
        if (err) {
          console.log(err);
          connection.release();

          var errMsg =
            i18next.t("mysql:QUERY_ERR") + " " + i18next.t("PLEASE_TRY_AGAIN");

          return next({
            message: errMsg,
            httpCode: HTTP_CODES.BAD_REQUEST,
          });
        }

        connection.release();

        return next(null, rows);
      }
    );
  });
};

exports.getUserDataByUserId = function (userId, options, next) {

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

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM user WHERE ?`, [{
        user_id: userId
      }], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        if(rows.length) {

          return next(null, rows[0]);
        } 
        
        return next(null, rows[0]);
      }
    );
  });
};

exports.getUserByUserId = async function (userId, options = { select: ['*'] }) {
  const query = `SELECT ${options.select} FROM user WHERE user_id = ? AND status = 'active' LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [userId]);
  return rows[0];
};

exports.getUserDataByUsername = function (username, options, next) {

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

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM user WHERE ?`, [{
        username: username
      }], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        if(rows.length) {

          return next(null, rows[0]);
        } 
        
        return next(null, rows[0]);
      }
    );
  });
};

exports.getUserDataByEmail = async function(email, selectColumns) {
    
    const query = `
        SELECT ${selectColumns}
        FROM user
        WHERE email = ?
        AND deleted_at IS NULL;
    `;
    const values = [email];

    return await mysqlQueryRunner.runQueryInMaster(query, values);
}

exports.getUserDataByMobile = async function(mobile, selectColumns) {
    
    const query = `
        SELECT ${selectColumns}
        FROM user
        WHERE mobile = ?
        AND deleted_at IS NULL;
    `;
    const values = [mobile];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
}

exports.getUserDataByEmailOrMobile = async function(emailOrMobile, selectColumns) {
    
    const query = `
        SELECT ${selectColumns}
        FROM user
        WHERE (email = ? OR mobile = ?)
        AND deleted_at IS NULL;
    `;
    const values = [emailOrMobile, emailOrMobile];
    
    return await mysqlQueryRunner.runQueryInMaster(query, values);
}

exports.getUserVillage = function (userId, options, next) {

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

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT ${options.select}  FROM village_member WHERE user_id = ? AND deleted_at IS NULL`, [
        userId
      ], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        if(rows.length) {

          return next(null, rows[0]);
        } 
        
        return next(null, rows[0]);
      }
    );
  });
};

exports.checkIfUsernameIsTaken = async (username) => {
  const query = `
    SELECT 
      change_id,
      user_id,
      old_username,
      new_username
    FROM 
      username_change
    WHERE 
      old_username = '${username}' OR
      new_username = '${username}'
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.getRecentNotificationDateOfGivenUserId = function(userId, next) {

  slaveConnection.getConnection(function (connErr, connection) {

    if (connErr) {
        
      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if(connection) {
        
        connection.release();
      }

      return next(finalErrObj);
    }

    connection.query(
      `SELECT 
        created_at
      FROM 
        notification
      WHERE 
        receiver_user_id = ?
        AND deleted_at IS NULL
      ORDER BY 
        created_at DESC
      LIMIT 1`, [userId], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          return next(finalErrObj);
        }

        connection.release();

        if(rows.length) {

          return next(null, rows[0].created_at);
        } 
        
        return next(null, null);
      }
    );
  });
};

exports.getAdminUserRoleByUserId = async function(userId, options, next) {
  
  if (_.isFunction(options) && !next) {

    // set next value as second param
    // sometimes you don't pass options
    next = options;
    options = {
      select: [`*`],
    };
  }

  adminDebug.log('user.dbo.getAdminUserRoleByUserId:query', { userId: userId });

  // Use master so this gate matches RbacModel (master) and JWT claims; replica lag could wrongly deny/allow OAuth.
  masterConnection.getConnection(function (connErr, connection) {

    if (connErr) {
        
      console.error(chalk.red(connErr));

      var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);

      if(connection) {
        
        connection.release();
      }

      adminDebug.warn('user.dbo.getAdminUserRoleByUserId:conn_err', { userId: userId, message: connErr.message });
      return next(finalErrObj);
    }

    connection.query(
      `SELECT role_id, user_id FROM admin_user_role WHERE user_id = ? AND DELETED_AT IS NULL`, [userId], function (err, rows) {

        if (err) {

          console.error(chalk.red(err));
          connection.release();
          
          var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);

          adminDebug.warn('user.dbo.getAdminUserRoleByUserId:query_err', { userId: userId, message: finalErrObj.message });
          return next(finalErrObj);
        }

        connection.release();

        if (rows.length) {
          adminDebug.log('user.dbo.getAdminUserRoleByUserId:hit', {
            userId: userId,
            role_id: rows[0].role_id,
            admin_user_role_row: true
          });
          return next(null, rows[0]);
        }

        adminDebug.log('user.dbo.getAdminUserRoleByUserId:miss', { userId: userId, rowCount: 0 });
        return next(null, null);
      }
    );
  });
};

