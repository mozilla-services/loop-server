"use strict";
var convict = require('convict');
var format = require('util').format;
var crypto = require('crypto');

/**
 * Validates the keys are present in the configuration object.
 *
 * @param {List} keys  A list of keys that must be present.
 **/
function validateKeys(keys) {
  return function(val) {
    if (!val)
      throw new Error("Should be defined");
    keys.forEach(function(key) {
      if (!val.hasOwnProperty(key))
        throw new Error(format("Should have a %s property", key));
    });
  };
}

function hexKeyOfSize(size) {
  return function check(val) {
    if (val === "")
      return;
    if (!new RegExp('^[a-f0-9]{' + size * 2 + '}$').test(val)){
      throw new Error("Should be an " + size +
                      " bytes key encoded as hexadecimal");
    }
  };
}

var conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: ["production", "development", "test"],
    default: "development",
    env: "NODE_ENV"
  },
  ip: {
    doc: "The IP address to bind.",
    format: "ipaddress",
    default: "127.0.0.1",
    env: "IP_ADDRESS"
  },
  port: {
    doc: "The port to bind.",
    format: "port",
    default: 5000,
    env: "PORT"
  },
  macSecret: {
    doc: "The secret for MAC tokens (32 bytes key encoded as hex)",
    format: hexKeyOfSize(32),
    default: "",
    env: "MAC_SECRET"
  },
  encryptionSecret: {
    doc: "The secret for encrypting tokens (16 bytes key encoded as hex)",
    format: hexKeyOfSize(16),
    default: "",
    env: "ENCRYPTING_SECRET"
  },
  userMacSecret: {
    doc: "The secret for hmac-ing userIds (16 bytes key encoded as hex)",
    format: hexKeyOfSize(16),
    default: "",
    env: "USER_MAC_SECRET"
  },
  userMacAlgorithm: {
    doc: "The algorithm that should be used to mac userIds",
    format: function(val) {
      if (crypto.getHashes().indexOf(val) === -1) {
        throw new Error("Given hmac algorithm is not supported");
      }
    },
    default: "sha256",
    env: "USER_MAC_ALGORITHM"
  },
  callUrlTimeout: {
    doc: "How much time a token is valid for (in hours)",
    format: Number,
    default: 24 * 30 // One month.
  },
  callUrlMaxTimeout: {
    doc: "The maximum number of hours a token can be valid for.",
    format: Number,
    default: 24 * 30
  },
  displayVersion: {
    doc: "Display the server version on the homepage.",
    default: true,
    format: Boolean
  },
  storage: {
    doc: "storage config",
    format: validateKeys(["engine", "settings"]),
    default: {engine: "redis", settings: {}}
  },
  fakeTokBox: {
    doc: "Mock TokBox calls",
    format: Boolean,
    default: false
  },
  tokBox: {
    doc: "TokBox service config",
    format: validateKeys(["apiKey", "apiSecret", "serverIP", "tokenDuration"]),
    default: ""
  },
  webAppUrl: {
    doc: "Loop Web App Home Page.",
    format: "url",
    default: "http://localhost:3000/static/#call/{token}",
    env: "WEB_APP_URL"
  },
  sentryDSN: {
    doc: "Sentry DSN",
    format: function(val) {
      if (!(typeof val === "string" || val === false)) {
        throw new Error("should be either a sentryDSN or 'false'");
      }
    },
    default: false,
    env: "SENTRY_DSN"
  },
  allowedOrigins: {
    doc: "Authorized origins for cross-origin requests.",
    format: Array,
    default: ['http://localhost:3000']
  }
});


var env = conf.get('env');
try {
  conf.loadFile('./config/' + env + '.json');
} catch (err) {
  console.log("Please create your config/" + env + ".json file.\n" +
              "You can use config/sample.json as an example.\n");
  process.exit(1);
}

conf.validate();

if (conf.get('macSecret') === "")
  throw "Please define macSecret in your configuration file";

if (conf.get('encryptionSecret') === "")
  throw "Please define encryptionSecret in your configuration file";

if (conf.get('allowedOrigins') === "") {
  throw "Please defined the list of allowed origins for CORS.";
}
module.exports = {
  conf: conf,
  hexKeyOfSize: hexKeyOfSize,
  validateKeys: validateKeys
};
