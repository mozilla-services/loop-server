/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var convict = require('convict');
var format = require('util').format;
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');

/**
 * Validates the keys are present in the configuration object.
 *
 * @param {List}    keys      A list of keys that must be present.
 * @param {Boolean} options   List of options to use.
 **/
function validateKeys(keys, options) {
  options = options || {};
  var optional = options.optional || false;

  return function(val) {
    if (JSON.stringify(val) === "{}" && optional === true) {
      return;
    }
    if (!optional && !val)
      throw new Error("Should be defined");
    keys.forEach(function(key) {
      if (!val.hasOwnProperty(key))
        throw new Error(format("Should have a %s property", key));
    });
  };
}

/**
 * Build a validator that makes sure of the size and hex format of a key.
 *
 * @param {Integer} size  Number of bytes of the key.
 **/
function hexKeyOfSize(size) {
  return function check(val) {
    if (val === "")
      return;
    if (!new RegExp(format('^[a-fA-FA0-9]{%d}$', size * 2)).test(val)) {
      throw new Error("Should be an " + size +
                      " bytes key encoded as hexadecimal");
    }
  };
}

var conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: [ "dev", "test", "stage", "prod" ],
    default: "dev",
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
  fakeTokBoxURL: {
    doc: "URL where to Mock TokBox calls",
    format: String,
    default: "http://httpbin.org/deny"
  },
  tokBox: {
    doc: "TokBox service config",
    format: validateKeys(["apiKey", "apiSecret", "tokenDuration"]),
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
  statsd: {
    doc: "Statsd configuration",
    format: validateKeys(['port', 'host'], {'optional': true}),
    default: {}
  },
  statsdEnabled: {
    doc: "Defines if statsd is enabled or not",
    format: Boolean,
    default: false
  },
  allowedOrigins: {
    doc: "Authorized origins for cross-origin requests.",
    format: Array,
    default: ['http://localhost:3000']
  },
  retryAfter: {
    doc: "Seconds to wait for on 503",
    format: Number,
    default: 30
  },
  consoleDateFormat: {
    doc: "Date format of the logging line in development.",
    format: String,
    default: "%y/%b/%d %H:%M:%S"
  },
  fxaAudience: {
    doc: "The domain of the website (for FxA verification)",
    format: String,
    env: "FXA_AUDIENCE",
    default: undefined
  },
  fxaVerifier: {
    doc: "The Firefox Accounts verifier url",
    format: String,
    env: "FXA_VERIFIER",
    default: "https://verifier.accounts.firefox.com/v2",
  },
  hawkSessionDuration: {
    doc: "The duration of hawk credentials (in seconds)",
    format: Number,
    default: 3600 * 24 * 30 // One month.
  }
});


// handle configuration files.  you can specify a CSV list of configuration
// files to process, which will be overlayed in order, in the CONFIG_FILES
// environment variable. By default, the ../config/<env>.json file is loaded.

var envConfig = path.join(__dirname + '/../config', conf.get('env') + '.json');
var files = (envConfig + ',' + process.env.CONFIG_FILES)
    .split(',')
    .filter(fs.existsSync);

conf.loadFile(files);
conf.validate();

if (conf.get('macSecret') === "")
  throw "Please define macSecret in your configuration file";

if (conf.get('encryptionSecret') === "")
  throw "Please define encryptionSecret in your configuration file";

if (conf.get('allowedOrigins') === "") {
  throw "Please defined the list of allowed origins for CORS.";
}

if (conf.get('hawkSessionDuration') <
    conf.get('callUrlMaxTimeout') * 60 * 60) {
  throw "hawkSessionDuration should be longer or equal to callUrlMaxTimeout.";
}
module.exports = {
  conf: conf,
  hexKeyOfSize: hexKeyOfSize,
  validateKeys: validateKeys
};
