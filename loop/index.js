/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var express = require('express');
var tokenlib = require('./tokenlib');
var sessions = require("./sessions");
var conf = require('./config').conf;
var hexKeyOfSize = require('./config').hexKeyOfSize;
var getStore = require('./stores').getStore;
var crypto = require('crypto');
var pjson = require('../package.json');
var request = require('request');
var raven = require('raven');
var cors = require('cors');
var errors = require('connect-validation');

var TokBox = require('./tokbox').TokBox;

var ravenClient = new raven.Client(conf.get('sentryDSN'));

function logError(err) {
  console.log(err);
  ravenClient.captureError(err);
}

var app = express();

app.use(express.json());
app.use(express.urlencoded());
app.use(errors);
app.use(sessions.clientSessions);
app.use(app.router);
// Exception logging should come at the end of the list of middlewares.
app.use(raven.middleware.express(conf.get('sentryDSN')));

var corsEnabled = cors({
  origin: function(origin, callback) {
    var acceptedOrigin = conf.get('allowedOrigins').indexOf(origin) !== -1;
    callback(null, acceptedOrigin);
  },
  // Configures the Access-Control-Allow-Credentials CORS header, required
  // until we stop sending cookies.
  credentials: true
});

var tokenManager = new tokenlib.TokenManager({
  macSecret: conf.get('macSecret'),
  encryptionSecret: conf.get('encryptionSecret')
});

var urlsStore = getStore(
  conf.get('urlsStore'),
  {unique: ["userMac", "simplepushURL"]}
);

var callsStore = getStore(
  conf.get('callsStore'),
  {unique: ["userMac", "sessionId"]}
);

var urlsRevocationStore = getStore(
  conf.get('urlsRevocationStore'),
  {unique: ["uuid"]}
);

var tokBox = new TokBox(conf.get('tokBox'));

function validateToken(req, res, next) {
  try {
    req.token = tokenManager.decode(req.param('token'));
    urlsRevocationStore.findOne({uuid: req.token.uuid}, function(err, record) {
      if (err) {
        logError(err);
        res.json(503, "Service unavailable");
        return;
      }
      if (record) {
        res.sendError("url", "token", "invalid token");
        return;
      }
      next();
    });
  } catch(err) {
    logError(err);
    res.sendError("url", "token", "invalid token");
    return;
  }
}

function requireParams() {
  var params = Array.prototype.slice.call(arguments);
  return function(req, res, next) {
    var missingParams;

    if (!req.accepts("json")) {
      res.json(406, ['application/json']);
      return;
    }

    missingParams = params.filter(function(param) {
      return req.body[param] === undefined;
    });

    if (missingParams.length > 0) {
      missingParams.forEach(function(item) {
        res.addError("body", item, "missing: " + item);
      });
      res.sendError();
    }
    next();
  };
}

/**
 * Returns the HMac digest of the given payload.
 *
 * If no options are passed, the global configuration object is used to
 * determine which algorithm and secret should be used.
 *
 * @param {String} payload    The string to mac.
 * @param {String} secret     key encoded as hex.
 * @param {String} algorithm  Algorithm to use (defaults to sha256).
 * @return {String} hexadecimal hash.
 **/
function hmac(payload, secret, algorithm) {
  if (secret === undefined) {
    throw new Error("You should provide a secret.");
  }

  // Test for secret size and validity
  hexKeyOfSize(16)(secret);

  if (algorithm === undefined) {
    algorithm = conf.get("userMacAlgorithm");
  }
  var _hmac = crypto.createHmac(
    algorithm,
    new Buffer(secret, "hex")
  );
  _hmac.write(payload);
  _hmac.end();
  return _hmac.read().toString('hex');
}

/**
 * Enable CORS for all requests.
 **/
app.all('*', corsEnabled);

/**
 * Displays some version information at the root of the service.
 **/
app.get("/", function(req, res) {
  var credentials = {
    name: pjson.name,
    description: pjson.description,
    version: pjson.version,
    homepage: pjson.homepage,
    endpoint: req.protocol + "://" + req.get('host')
  };

  if (!conf.get("displayVersion")) {
    delete credentials.version;
  }
  res.json(200, credentials);
});

/**
 * Registers the given user with the given simple push url.
 **/
app.post('/registration',
  sessions.attachSession, requireParams("simple_push_url"),
  function(req, res) {
    var simplePushURL = req.body.simple_push_url;
    if (simplePushURL.indexOf('http') !== 0) {
      res.sendError("body", "simple_push_url",
                    "simple_push_url should be a valid url");
      return;
    }

    // XXX Bug 980289 —
    // With FxA we will want to handle many SimplePushUrls per user.
    var userHmac = hmac(req.user, conf.get('userMacSecret'));
    urlsStore.updateOrCreate({userMac: userHmac}, {
      userMac: userHmac,
      simplepushURL: simplePushURL
    }, function(err, record){
      if (err) {
        logError(err);
        res.json(503, "Service Unavailable");
        return;
      }
      res.json(200, "ok");
    });
  });

/**
 * Generates and return a call-url for the given callerId.
 **/
app.post('/call-url', sessions.requireSession, sessions.attachSession,
  requireParams('callerId'), function(req, res) {
    var uuid = crypto.randomBytes(4).toString("hex");
    var token = tokenManager.encode({
      user: req.user,
      uuid: uuid,
      callerId: req.body.callerId
    });
    var host = req.protocol + "://" + req.get('host');
    res.json(200, {call_url: host + "/calls/" + token});
  });

/**
 * List all the pending calls for the authenticated user.
 **/
app.get("/calls", sessions.requireSession, sessions.attachSession,
  function(req, res) {
    if (!req.query.hasOwnProperty('version')) {
      res.sendError("querystring", "version", "missing: version");
      return;
    }

    var version = req.query.version;

    callsStore.find({userMac: hmac(req.user, conf.get('userMacSecret'))},
      function(err, records) {
        if (err) {
          logError(err);
          res.json(503, "Service Unavailable");
          return;
        }

        var calls = records.filter(function(record) {
          return record.timestamp >= version;
        }).map(function(record) {
          return {
            callId: record.callId,
            apiKey: tokBox.apiKey,
            sessionId: record.sessionId,
            sessionToken: record.calleeToken
          };
        });

        res.json(200, {calls: calls});
      });
  });

/**
 * Do a redirect to the Web client.
 **/
app.get('/calls/:token', validateToken, function(req, res) {
  res.redirect(conf.get("webAppUrl").replace("{token}", req.param('token')));
});

/**
 * Revoke a given call url.
 **/
app.delete('/call-url/:token', sessions.requireSession, sessions.attachSession,
  validateToken, function(req, res) {
    if (req.token.user !== req.user) {
      res.json(403, "Forbidden");
      return;
    }
    urlsRevocationStore.add({
      uuid: req.token.uuid,
      ttl: (req.token.expires * 60 * 60 * 1000) - new Date().getTime()
    }, function(err, record) {
      if (err) {
        logError(err);
        res.json(503, "Service Unavailable");
        return;
      }
      res.json(204, "");
    });
  });

/**
 * Initiate a call with the user identified by the given token.
 **/
app.post('/calls/:token', validateToken, function(req, res) {
    tokBox.getSessionTokens(function(err, tokboxInfo) {
      if (err) {
        logError(err);
        res.json(503, "Service Unavailable");
        return;
      }

      var currentTimestamp = new Date().getTime();
      var callId = crypto.randomBytes(16).toString("hex");

      callsStore.add({
        "callerId": req.token.callerId,
        "callId": callId,
        "userMac": hmac(req.token.user, conf.get("userMacSecret")),
        "sessionId": tokboxInfo.sessionId,
        "calleeToken": tokboxInfo.calleeToken,
        "timestamp": currentTimestamp
      }, function(err, record){
        if (err) {
          logError(err);
          res.json(503, "Service Unavailable");
          return;
        }
        urlsStore.find({
          userMac: hmac(req.token.user, conf.get('userMacSecret'))
        }, function(err, items) {
          if (err) {
            res.json(503, "Service Unavailable");
            return;
          }
          // Call SimplePush urls.
          items.forEach(function(item) {
            request.put({
              url: item.simplepushURL,
              form: {version: currentTimestamp}
            });
          });
          res.set("Access-Control-Allow-Origin", conf.get('allowedOrigins'));
          res.set("Access-Control-Allow-Methods", "GET,POST");
          res.json(200, {
            callId: callId,
            sessionId: tokboxInfo.sessionId,
            sessionToken: tokboxInfo.callerToken,
            apiKey: tokBox.apiKey
          });
        });
      });
    });
  });

/**
 * Returns the status of a given call.
 **/
app.get('/calls/id/:callId', function(req, res) {
  var callId = req.param('callId');
  callsStore.findOne({callId: callId}, function(err, result) {
    if (err) {
      logError(err);
      res.json(503, "Service Unavailable");
      return;
    }
    if (result === null) {
      res.json(404, {error: "Call " + callId + " not found."});
      return;
    }
    res.json(200, "ok");
  });
});

/**
 * Rejects or cancel a given call.
 **/
app.delete('/calls/id/:callId', function(req, res) {
    var callId = req.param('callId');

    callsStore.delete({callId: callId}, function(err, result) {
      if (err) {
        logError(err);
        res.json(503, "Service Unavailable");
        return;
      }
      if (result === null) {
        res.json(404, {error: "Call " + callId + " not found."});
        return;
      }
      res.json(204, "");
    });
  });

app.listen(conf.get('port'), conf.get('host'), function(){
  console.log('Server listening on http://' +
              conf.get('host') + ':' + conf.get('port'));
});

module.exports = {
  app: app,
  conf: conf,
  urlsStore: urlsStore,
  callsStore: callsStore,
  urlsRevocationStore: urlsRevocationStore,
  hmac: hmac,
  validateToken: validateToken,
  requireParams: requireParams,
  request: request,
  tokBox: tokBox
};
