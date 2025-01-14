"use strict";

module.exports = {
  env: "",
  appDomain: "http://localhost",
  appPort: 5000,
  exposedDomainUrl: "",
  creatorsWebDomainUrl: "",
  creatorsWebDomainLoginUrl: "",
  fileServerUrl: "",
  apiVersions: {
    v1: {
      prefix: "api",
      versionNumber: "1.0.0",
    },
  },
  defaultValues: {
    locale: "en",
    languageId: "",
    country: "IN",
  },
  mysql: {
    master: {
      url: "localhost",
      port: "3306",
      databaseName: "",
      options: {
        user: "",
        pass: "",
      },
      debug: true
    },
    slave: {
      url: "localhost",
      port: "3306",
      databaseName: "",
      options: {
        user: "",
        pass: "",
      },
      debug: true
    }
  },
  mongodb: {
    url: "localhost",
    port: "27017",
    databaseName: "",
    options: {
      user: "",
      pass: "",
    },
    debug: true,
  },
  redis: {
    sessionPrefix: "",
    auth: {
      port: "",
      host: "",
      pass: "",
    },
  },
  bcrypt: {
    saltRounds: 10,
  },
  facebook: {
    clientID: "",
    clientSecret: "",
    callbackURL: "",
  },
  google: {
    clientID: "",
    clientSecret: "",
    callbackURL: "",
  },
  jwt: {
    secret: "",
    expiresIn: 1,
    expiresInMilliseconds: 1000,
  },
  refreshToken: {
    secret: "",
    expiresIn: 1,
    expiresInMilliseconds: 1000,
  },
  moment: {
    dbFormat: "YYYY-MM-DD HH:mm:ss",
  },
  aes256gcm: {
    secret: "",
  },
  bs2: {
    apiKey: "",
    url: "",
    fileUrl: "",
    activeFileDomain: "",
  },
  sendgrid: {
    apiKey: "",
    fromEmail: "",
    fromName: "",
    templates: {
      resetPassword: "",
      regVerifyEmail: "",
    },
  },
  bcrypt: {
    saltRounds: 1,
    resetPwdTokenSaltRounds: 1,
  },
  cookieDomain: "",
  pagination: {
    itemsPerPage: 10,
  },
  defaultUser: {
    email: "",
    password: "",
  },
  queuesUrl: "",
  pwaWebDomainUrl: ""
};
