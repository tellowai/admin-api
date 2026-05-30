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
    },
    /** Read-only MySQL user for the admin LLM chat. Falls back to slave creds if unset. */
    adminLlmChatReadonly: {
      url: "localhost",
      port: "3306",
      databaseName: "",
      options: {
        user: "",
        pass: "",
      },
      debug: false
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
    /** Same Play Billing service account as photobop-api (Android Publisher scope). Optional unless Play Store admin lists are used. */
    clientEmail: "",
    privateKey: "",
    appPackageName: "",
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
  pwaWebDomainUrl: "",
  /** photobop-api origin (no trailing slash) + shared key for server-to-server calls (e.g. Play fulfilment). Legacy key `photobopApi` is still read if `publicApi` is absent. */
  publicApi: {
    baseUrl: "",
    /** Optional path prefix (e.g. "v1" or "/v1") if the API is not mounted at the origin root. */
    routePrefix: "",
    internalServiceKey: ""
  },
  adminLlmChat: {
    /** Override with ADMIN_LLM_CHAT_ENABLED or adminLlmChat.enabled in config/env/local.js */
    enabled: false,
    /** Optional absolute path to models.json — or set ADMIN_LLM_CHAT_MODELS_PATH */
    modelsPath: "",
    /** Max tool calls per assistant turn. Override with ADMIN_LLM_CHAT_MAX_TOOL_CALLS. */
    maxToolCallsPerTurn: 24,
    /** Brand name for the chat (system prompt, business context). Override with ADMIN_LLM_CHAT_COMPANY_NAME, e.g. "Kriya AI". Defaults to "Tellow AI". */
    companyName: "",
    /** render_widget tool. Override with ADMIN_LLM_CHAT_TOOL_RENDER_WIDGET_ENABLED. */
    toolRenderWidgetEnabled: true,
    /** Per-widget flags (widget type id → boolean). Override with ADMIN_LLM_CHAT_WIDGET_<TYPE>. */
    widgets: {
      kpi_cards: true,
      data_table: true,
      line_chart: true,
      bar_chart: true,
      pie_chart: true,
      callout: true,
      vega_lite_chart: false,
    },
  },
  llmProviders: {
    openai: { apiKey: "" },
    anthropic: { apiKey: "" },
  },
  clickhouse: {
    master: { url: "", port: "", databaseName: "", user: "", password: "", debug: false },
    slave: { url: "", port: "", databaseName: "", user: "", password: "", debug: false },
    adminLlmChatReadonly: { url: "", port: "", databaseName: "", user: "", password: "", debug: false },
  },
  telegram: {
    botToken: "",
    chatIds: [],
  },
  internalAuth: {
    digestHmacSecret: "",
  },
  metaAds: {
    accessToken: "",
    adAccountIds: [],
    apiVersion: "v21.0",
  },
  googleAds: {
    developerToken: "",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    customerId: "",
    loginCustomerId: "",
  },
};
