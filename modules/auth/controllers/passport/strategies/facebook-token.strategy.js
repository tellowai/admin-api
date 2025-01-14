var passport = require('passport');
var passportStrategy = require('passport-facebook-token');
const FacebookTokenStrategy = passportStrategy;
var moment = require('moment');
var async = require('async');
var cuid = require('cuid');

var config = require('../../../../../config/config');
var AuthDbo = require('../../../dbo/auth.dbo');
var versionConfig = require('../../../../version');
const { createId } =  require('@paralleldrive/cuid2');


module.exports = function () {

  var callbackURL = config.exposedDomainUrl + versionConfig.routePrefix +
    config.facebook.callbackURL;

  passport.use(
    new FacebookTokenStrategy(
      {
        clientID: config.facebook.clientID,
        clientSecret: config.facebook.clientSecret,
        callbackURL: callbackURL,
        profileFields: [
          "id",
          "email",
          "name",
          "short_name",
          "displayName",
          "picture.type(large)"
        ]
      },
      function(accessToken, refreshToken, profile, done) {

        var userDataFromFb = restructureFacebookData(profile);

        AuthDbo.getUserDataByProviderBackedUserId(
          userDataFromFb.user_id_from_provider, function (err, existingUserData) {

          if(err) {

            return done(err);
          }

          return done(null, {
            userDataFromFb: userDataFromFb,
            existingUserData: existingUserData
          })
        });
      }
    )
  );
}

function restructureFacebookData(profile) {
  var user = {
    user_id : createId(),
    status : 'active',
    created_at : moment().format(config.moment.dbFormat),
    updated_at : moment().format(config.moment.dbFormat)
  };

  if(profile._json) {
    var userProfileData = profile._json;

    // user id from provider database
    if(userProfileData.id) {

      user.user_id_from_provider = userProfileData.id
    }

    // user name
    if(userProfileData.name) {
      var nameArr = userProfileData.name.split(" ");

      if(nameArr.length > 2) {

        user.first_name = nameArr[0];
        user.middle_name = nameArr[1];
        user.last_name = nameArr[2];
      } else if(nameArr.length == 2) {

        user.first_name = nameArr[0];
        user.last_name = nameArr[1];
      } else if(nameArr.length == 1) {

        user.first_name = nameArr[0];
      }

    } else if(userProfileData.first_name) {
      user.first_name = userProfileData.first_name;
    } else if(userProfileData.last_name) {
      user.last_name = userProfileData.last_name;
    } else if(userProfileData.short_name) {

      var nameArr = userProfileData.short_name.split(" ");

      if(nameArr.length > 2) {

        user.first_name = nameArr[0];
        user.middle_name = nameArr[1];
        user.last_name = nameArr[2];
      } else if(nameArr.length == 2) {

        user.first_name = nameArr[0];
        user.last_name = nameArr[1];
      } else if(nameArr.length == 1) {

        user.first_name = nameArr[0];
      }
    } else if (userProfileData.displayName) {
      var nameArr = userProfileData.displayName.split(" ");

      if(nameArr.length > 2) {

        user.first_name = nameArr[0];
        user.middle_name = nameArr[1];
        user.last_name = nameArr[2];
      } else if(nameArr.length == 2) {

        user.first_name = nameArr[0];
        user.last_name = nameArr[1];
      } else if(nameArr.length == 1) {

        user.first_name = nameArr[0];
      }
    }

    // user email
    if(userProfileData.email) {
      user.email = userProfileData.email;
      user.is_email_verified = true;
    }
  } else {

    // user id from provider database
    if(profile.id) {

      user.user_id_from_provider = profile.id
    }

    if(profile.name && profile.givenName &&
      profile.middleName && profile.familyName) {

      if(profile.name) {
        var nameArr = profile.name.split(" ");
  
        if(nameArr.length > 2) {
  
          user.first_name = nameArr[0];
          user.middle_name = nameArr[1];
          user.last_name = nameArr[2];
        } else if(nameArr.length == 2) {
  
          user.first_name = nameArr[0];
          user.last_name = nameArr[1];
        } else if(nameArr.length == 1) {
  
          user.first_name = nameArr[0];
        }
  
      } else if(profile.givenName) {
        user.first_name = profile.givenName;
      } else if(profile.middleName) {
        user.middle_name = profile.middleName;
      } else if(profile.familyName) {
        user.last_name = profile.familyName;
      }
    } else if(profile.displayName) {

      if(profile.displayName) {
        var nameArr = profile.displayName.split(" ");
  
        if(nameArr.length > 2) {
  
          user.first_name = nameArr[0];
          user.middle_name = nameArr[1];
          user.last_name = nameArr[2];
        } else if(nameArr.length == 2) {
  
          user.first_name = nameArr[0];
          user.last_name = nameArr[1];
        } else if(nameArr.length == 1) {
  
          user.first_name = nameArr[0];
        }
  
      }
    }

    // user email
    if(profile.emails && profile.emails.length &&
        profile.emails[0].value) {
      user.email = profile.emails[0].value;
      user.is_email_verified = true;
    }
  }

  // user profile photo
  if(profile.photos &&
    profile.photos.length &&
    profile.photos[0].value) {

    user.profile_pic = profile.photos[0].value;
  }

  return user;
}
