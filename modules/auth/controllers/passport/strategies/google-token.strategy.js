var passport = require('passport');
var GoogleStrategy = require('passport-google-oauth20').Strategy;
var moment = require('moment');
var config = require('../../../../../config/config');
var cuid = require('cuid');
var versionConfig = require('../../../../version');
var AuthDbo = require('../../../dbo/auth.dbo');
const { createId } =  require('@paralleldrive/cuid2');


module.exports = function () {

  var callbackURL =  config.exposedDomainUrl + versionConfig.routePrefix +
    config.google.callbackURL;

  passport.use(
    new GoogleStrategy({
        clientID: config.google.clientID,
        clientSecret: config.google.clientSecret,
        callbackURL: callbackURL,
        passReqToCallback : true
      }, function(req, token, tokenSecret, profile, done) {

        var userDataFromGoogle = restructureGoogleData(profile);

        AuthDbo.getUserDataByProviderBackedUserId(
          userDataFromGoogle.user_id_from_provider, function (err, existingUserData) {

          if(err) {

            return done(err);
          }
          
          return done(null, {
            userDataFromGoogle: userDataFromGoogle,
            existingUserData: existingUserData
          })
        });
      }
    )
  );
}

function restructureGoogleData(profile) {
  var user = {
    user_id : createId(),
    display_name: "Guest",
    created_at : moment().format(config.moment.dbFormat),
    updated_at : moment().format(config.moment.dbFormat)
  };

  // user name and display name
  if(profile.name) {
    if(profile.name.familyName) {
      user.last_name = profile.name.familyName;
    }
    if(profile.name.givenName) {
      user.first_name = profile.name.givenName;
    }
    if(profile.name.givenName && profile.name.familyName) {
      user.display_name = profile.name.givenName + " " + profile.name.familyName;
    }
  }

  if(profile.displayName) {
    user.display_name = profile.displayName;
  }

  // user email
  if(profile.emails && profile.emails.length && profile.emails[0].value) {
    user.email = profile.emails[0].value;
  }

  // profile photo
  if(profile.photos && profile.photos.length && profile.photos[0].value) {
    user.profile_pic = profile.photos[0].value;
  }

  // handle _json data
  if(profile._json) {
    var userProfileData = profile._json;

    if(!user.email && userProfileData.email) {
      user.email = userProfileData.email;
    }

    if(!user.profile_pic && userProfileData.picture) {
      user.profile_pic = userProfileData.picture;
    }

    if(userProfileData.sub) {
      user.user_id_from_provider = userProfileData.sub;
    }
  }

  return user;
}
