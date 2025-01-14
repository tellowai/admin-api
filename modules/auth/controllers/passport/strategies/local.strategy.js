var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var i18next = require('i18next');
var bcrypt = require('bcrypt');
var UsersDbo = require('../../../dbo/user.dbo');
var config = require('../../../../../config/config');
var async = require('async');

module.exports = function () {

  passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  },
  function(email, password, done) {

    async.waterfall([
      function(next) {
        UsersDbo.getUserEmailAndPwd(
          email, function (err, existingUserData) {
            
          if(err) {

            return next(err);
          }

          // User exists
          if(!existingUserData.length) {
            var errMsg = i18next.t('user:INVALID_EMAIL_OR_PASSWORD');
            var errObj = {
              "noRecords" : errMsg
            }
            return next(errObj);
          } else if(existingUserData[0].password) {

            var hash = existingUserData[0].password;
            comparePwdHash(password, hash, function(err, isMatching) {
              if(err) {

                return next(err);
              }

              if(isMatching) {

                if(!existingUserData[0].is_email_verified) {

                  var errMsg = i18next.t('user:EMAIL_NOT_VERIFIED') + " " + i18next.t('CONTACT_SUPPORT');
                  var errObj = {
                    "authError" : errMsg
                  }
                  return next(errObj);

                }

                return next(null, existingUserData);
              } else {

                var errMsg = i18next.t('user:INVALID_EMAIL_OR_PASSWORD');
                var errObj = {
                  "authError" : errMsg
                }
                return next(errObj);
              }
            });
          } else if(!existingUserData[0].password) {

            var errMsg = i18next.t('REGISTERED_WITH_SOCIAL_LOGINS');
            var errObj = {
              "socialLogins" : errMsg
            }
            return next(errObj);
          } else {
            var errMsg = i18next.t('SOMETHING_WENT_WRONG');
            var errObj = {
              "somethingWrong" : errMsg
            }

            return next(errObj);
          }
        });
      }
    ], function (errObj, finalResults) {

      if(errObj) {

        return done(errObj);
      }

      return done(null, finalResults);
    });
  }));
}

function comparePwdHash(pwd, hash, callback) {
  bcrypt.compare(pwd, hash, function(err, isMatching) {
    if(err) {
      return callback(err, null);
    }

    return callback(null, isMatching);
  });
}

function generatePwdHash(pwd, callback) {
    bcrypt.hash(pwd, config.bcrypt.saltRounds, function(err, hash) {
        console.log(err, hash);
        if(err) {

        return callback(err, null);
        }

        return callback(null, hash);
    });
}
