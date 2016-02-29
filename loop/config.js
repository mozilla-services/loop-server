/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var convict = require('convict');
var format = require('util').format;
var getHashes = require('crypto').getHashes;
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

/**
 * Validates that each channel has an apiKey and apiSecret as well as
 * an optional apiUrl and nothing else. Alse make sure the default
 * channel is defined.
 **/
function tokBoxCredentials(credentials) {
  if (!credentials.hasOwnProperty("default")) {
    throw new Error("Please define the default TokBox channel credentials.");
  }

  var authorizedKeys = ["apiKey", "apiSecret", "apiUrl"];

  function checkKeys(key) {
    if (authorizedKeys.indexOf(key) === -1) {
      throw new Error(key + " configuration value is unknown. " +
                      "Should be one of " + authorizedKeys.join(", ") + ".");
    }
  }

  for (var channel in credentials) {
    // Verify channel keys validity.
    Object.keys(credentials[channel]).forEach(checkKeys);

    if (!credentials[channel].hasOwnProperty("apiKey")) {
      throw new Error(channel + " channel should define an apiKey.");
    }
    if (!credentials[channel].hasOwnProperty("apiSecret")) {
      throw new Error(channel + " channel should define an apiSecret.");
    }
  }
}

var conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: [ "dev", "test", "stage", "prod", "loadtest"],
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
  acceptBacklog: {
    doc: "The maximum length of the queue of pending connections",
    format: Number,
    default: 511,
    env: "ACCEPT_BACKLOG"
  },
  publicServerAddress: {
    doc: "The public-facing server address",
    format: String,
    default: "localhost:5000",
    env: "SERVER_ADDRESS"
  },
  protocol: {
    doc: "The protocol the server is behind. Should be https behind an ELB.",
    format: String,
    default: "http",
    env: "PROTOCOL"
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
      if (getHashes().indexOf(val) === -1) {
        throw new Error("Given hmac algorithm is not supported");
      }
    },
    default: "sha256",
    env: "USER_MAC_ALGORITHM"
  },
  calls: {
    maxSubjectSize: {
      doc: "The maximum number of chars for the subject of a call",
      format: Number,
      default: 124
    }
  },
  callUrls: {
    tokenSize: {
      doc: "The callUrl token size (in bytes).",
      format: Number,
      default: 8
    },
    timeout: {
      doc: "How much time a token is valid for (in hours)",
      format: Number,
      default: 24 * 30 // One month.
    },
    maxTimeout: {
      doc: "The maximum number of hours a token can be valid for.",
      format: Number,
      default: 24 * 30
    },
    webAppUrl: {
      doc: "Loop Web App Home Page.",
      format: "url",
      default: "http://localhost:3000/c/{token}",
      env: "WEB_APP_URL"
    }
  },
  displayVersion: {
    doc: "Display the server version on the homepage.",
    default: true,
    format: Boolean
  },
  storage: {
    engine: {
      doc: "engine type",
      format: String,
      default: "redis"
    },
    settings: {
      doc: "js object of options to pass to the storage engine",
      format: Object,
      default: {
        port: 6379,
        host: 'localhost'
      }
    }
  },
  filestorage: {
    engine: {
      doc: "engine type",
      format: ["filesystem", "aws"],
      default: "filesystem"
    },
    settings: {
      doc: "js object of options to pass to the files engine",
      format: Object,
      default: {
        base_dir: "/tmp"
      }
    }
  },
  pubsub: {
    doc: "js object of options to pass to the pubsub engine",
    format: Object,
    default: {
      port: 6379,
      host: 'localhost'
    }
  },
  fakeTokBox: {
    doc: "Mock TokBox calls",
    format: Boolean,
    default: false
  },
  fakeTokBoxURL: {
    doc: "URL where to Mock TokBox calls",
    format: String,
    default: "https://call.stage.mozaws.net/"
  },
  tokBox: {
    apiUrl: {
      doc: 'api endpoint for tokbox',
      format: String,
      default: "https://api.opentok.com"
    },
    credentials: {
      doc: "api credentials based on a channel.",
      format: tokBoxCredentials,
      default: {}
    },
    tokenDuration: {
      doc: 'how long api tokens are valid for in seconds',
      format: "nat",
      default: 24 * 3600
    },
    retryOnError: {
      doc: 'how many times to retry on error',
      format: "nat",
      default: 3
    },
    timeout: {
      doc: "Timeout for requests when trying to create the session (ms)",
      format: Number,
      default: 2000
    }
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
  fxaAudiences: {
    doc: "List of accepted fxa audiences.",
    format: Array,
    default: []
  },
  fxaVerifier: {
    doc: "The Firefox Accounts verifier url",
    format: String,
    env: "FXA_VERIFIER",
    default: "https://verifier.accounts.firefox.com/v2"
  },
  fxaTrustedIssuers: {
    doc: "The list of Firefox Accounts trusted issuers",
    format: Array,
    default: ["api.accounts.firefox.com"]
  },
  hawkIdSecret: {
    doc: "The secret for hmac-ing the hawk id (16 bytes key encoded as hex)",
    format: hexKeyOfSize(16),
    default: "",
    env: "HAWK_ID_SECRET"
  },
  hawkSessionDuration: {
    doc: "The duration of hawk credentials (in seconds)",
    format: Number,
    default: 3600 * 24 * 30 // One month.
  },
  callDuration: {
    doc: "The duration we want to store the call info (in seconds)",
    format: Number,
    default: 60
  },
  maxHTTPSockets: {
    doc: "The maximum of HTTP sockets to use when doing requests",
    format: Number,
    default: 10000000
  },
  heartbeatTimeout: {
    doc: "Timeout for requests when doing heartbeat checks (ms)",
    format: Number,
    default: 2000
  },
  timers: {
    supervisoryDuration: {
      doc: "Websocket timeout for the supervisory timer (seconds)",
      format: Number,
      default: 10
    },
    ringingDuration: {
      doc: "Websocket timeout for the ringing timer (seconds)",
      format: Number,
      default: 30
    },
    connectionDuration: {
      doc: "Websocket timeout for the connection timer (seconds)",
      format: Number,
      default: 10
    }
  },
  progressURLEndpoint: {
    doc: "The endpoint to use for the progressURL.",
    format: String,
    default: "/websocket"
  },
  i18n: {
    defaultLang: {
      format: String,
      default: 'en-US'
    }
  },
  pushServerURIs: {
    doc: "An array of push server URIs",
    format: Array,
    default: ["wss://push.services.mozilla.com/"]
  },
  fxaOAuth: {
    activated: {
      doc: "Set to false if you want to deactivate FxA-OAuth on this instance.",
      format: Boolean,
      default: true
    },
    client_id: {
      doc: "The FxA client_id (8 bytes key encoded as hex)",
      format: hexKeyOfSize(8),
      default: ""
    },
    client_secret: {
      doc: "The FxA client secret (32 bytes key encoded as hex)",
      format: hexKeyOfSize(32),
      default: ""
    },
    oauth_uri: {
      doc: "The location of the FxA OAuth server.",
      format: "url",
      default: "https://oauth.accounts.firefox.com/v1"
    },
    content_uri: {
      doc: "The location of the FxA content server.",
      format: "url",
      default: "https://accounts.firefox.com"
    },
    redirect_uri: {
      doc: "The redirect_uri.",
      format: String,
      default: "urn:ietf:wg:oauth:2.0:fx:webchannel"
    },
    profile_uri: {
      doc: "The FxA profile uri.",
      format: "url",
      default: "https://profile.firefox.com/v1"
    },
    scope: {
      doc: "The scope we're requesting access to",
      format: String,
      default: "profile"
    }
  },
  logRequests: {
    activated: {
      doc: "Defines if requests should be logged to Stdout",
      default: false,
      format: Boolean
    },
    consoleDateFormat: {
      doc: "Date format of the logging line.",
      format: String,
      default: "%y/%b/%d %H:%M:%S"
    }
  },
  hekaMetrics: {
    activated: {
      doc: "Defines if metrics should be directed to hekad",
      default: false,
      format: Boolean
    },
    debug: {
      doc: "Heka logger display development logs",
      format: Boolean,
      default: false
    },
    level: {
      doc: "Log level.",
      format: String,
      default: "INFO"
    },
    fmt: {
      doc: "Log level.",
      format: String,
      default: "heka"
    }
  },
  newRelic: {
    activated: {
      doc: "Defines if newrelic is activated or not",
      default: false,
      format: Boolean
    },
    licenceKey: {
      doc: "New Relic licence key",
      format: String,
      default: ""
    },
    loggingLevel: {
      doc: "Logging level to use",
      format: String,
      default: "info"
    },
    appName: {
      doc: "New Relic application name",
      format: String,
      default: "Loop Server"
    }
  },
  dumpHeap: {
    activated: {
      doc: "Defines if uncaught exceptions should dump snapshots",
      default: true,
      format: Boolean
    },
    location: {
      doc: "Location where to output the files (directory).",
      format: String,
      default: '/tmp'
    }
  },
  rooms: {
    defaultTTL: {
      doc: "The default TTL for a room (in hours)",
      format: Number,
      default: 8 * 7 * 24 // 8 weeks
    },
    maxTTL: {
      doc: "The maximum TTL for a room (in hours) allowed by the server",
      format: Number,
      default: 8 * 7 * 24 // 8 weeks
    },
    extendTTL: {
      doc: "The new TTL for a room (in hours) after a participant join.",
      format: Number,
      default: 8 * 7 * 24 // 8 weeks
    },
    participantTTL: {
      doc: "The TTL (in seconds) for a participant in the room",
      format: Number,
      default: 5 * 60  // 5 minutes
    },
    deletedTTL: {
      doc: "The TTL (in seconds) for a room delete notification to be saved",
      format: Number,
      default: 27 * 60  // 27 minutes
    },
    maxSize: {
      doc: "The maximum size of a room",
      format: Number,
      default: 5
    },
    maxRoomNameSize: {
      doc: "The maximum number of chars to name a room",
      format: Number,
      default: 100
    },
    maxRoomOwnerSize: {
      doc: "The maximum number of chars for the owner of a room",
      format: Number,
      default: 255
    },
    tokenSize: {
      doc: "The room token size (in bytes).",
      format: Number,
      default: 8
    },
    webAppUrl: {
      doc: "Loop Web App rooms url.",
      format: "url",
      default: "http://localhost:3000/{token}",
      env: "ROOMS_WEB_APP_URL"
    },
    HKDFSalt: {
      doc: "The salt that will be used to cipher profile data " +
           "(16 bytes key encoded as hex)",
      format: hexKeyOfSize(16),
      default: "",
      env: "ROOMS_HKDF_SECRET"
    }
  },
  ga: {
    activated: {
      doc: "Should we send POST /events data to Google Analytics while true.",
      default: false,
      format: Boolean
    },
    id: {
      doc: "Google analytics ID.",
      default: "",
      format: String
    }
  }
});


// handle configuration files.  you can specify a CSV list of configuration
// files to process, which will be overlayed in order, in the CONFIG_FILES
// environment variable. By default, the ../config/<env>.json file is loaded.

var envConfig = path.join(__dirname, '/../config', conf.get('env') + '.json');
var files = (envConfig + ',' + process.env.CONFIG_FILES)
    .split(',')
    .filter(fs.existsSync);

conf.loadFile(files);
conf.validate();

if (conf.get('macSecret') === "")
  throw "Please define macSecret in your configuration file";

if (conf.get('rooms').HKDFSalt === "")
    throw "Please define rooms.HKDFSalt in your configuration file";

if (conf.get('encryptionSecret') === "")
  throw "Please define encryptionSecret in your configuration file";

if (conf.get('allowedOrigins') === "") {
  throw "Please define the list of allowed origins for CORS.";
}

if (conf.get('fxaAudiences').length === 0) {
  throw "Please define the list of allowed Firefox Accounts audiences";
}

if (conf.get('hawkSessionDuration') <
    conf.get('callUrls').maxTimeout * 60 * 60) {
  throw "hawkSessionDuration should be longer or equal to callUrls.maxTimeout";
}

if (conf.get('fxaOAuth').activated && conf.get('fxaOAuth').client_id === "") {
  throw "fxaOAuth is activated but not well configured. " +
    "Set fxaOAuth.activated config key to false to continue";
}

// Configure S3 the environment variable for tests.
if (conf.get('env') === 'test') {
  process.env.AWS_ACCESS_KEY_ID = 'TESTME';
  process.env.AWS_SECRET_ACCESS_KEY = 'TESTME';
}

// Verify timers
var timers = conf.get("timers");
var minCallDuration = timers.supervisoryDuration +
  timers.ringingDuration +
  timers.connectionDuration;
if (minCallDuration > conf.get("callDuration")) {
  throw "the callDuration should be at least " + minCallDuration + " seconds";
}

module.exports = {
  conf: conf,
  hexKeyOfSize: hexKeyOfSize,
  validateKeys: validateKeys
};
