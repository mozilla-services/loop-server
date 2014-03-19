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

var TokBox = require('./tokbox').TokBox;

var app = express();

app.use(express.json());
app.use(express.urlencoded());
app.use(sessions.clientSessions);
app.use(app.router);

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

var tokBox = new TokBox(conf.get('tokBox'));

function validateSimplePushURL(reqDataObj) {
  if (typeof reqDataObj !== 'object') {
    throw new Error('missing request data');
  }

  if (!reqDataObj.hasOwnProperty('simple_push_url')) {
    throw new Error('simple_push_url is required');
  }

  if (reqDataObj.simple_push_url.indexOf('http') !== 0) {
    throw new Error('simple_push_url should be a valid url');
  }

  return reqDataObj;
}

function validateToken(req, res, next) {
  if (!req.param('token')) {
    res.json(400, "miss the 'token' parameter");
    return;
  }

  try {
    req.token = tokenManager.decode(req.param('token'));
  } catch(err) {
    res.json(400, err);
    return;
  }
  next();
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

app.post('/registration', sessions.attachSession, function(req, res) {
  var validated;

  if (req.headers['content-type'] !== 'application/json') {
    res.json(406, ['application/json']);
    return;
  }

  try {
    validated = validateSimplePushURL(req.body);
  } catch (err) {
    res.json(400, {error: err.message});
    return;
  }

  // XXX Bug 980289 —
  // With FxA we will want to handle many SimplePushUrls per user.
  var userHmac = hmac(req.user, conf.get('userMacSecret'));
  urlsStore.updateOrCreate({userMac: userHmac}, {
    userMac: userHmac,
    simplepushURL: validated.simple_push_url
  }, function(err, record){
    if (err) {
      res.json(503, "Service Unavailable");
      return;
    }
    res.json(200, "ok");
  });
});

app.post('/call-url', sessions.requireSession, sessions.attachSession,
  function(req, res) {
    var uuid = crypto.randomBytes(4).toString("hex");
    var token = tokenManager.encode({
      user: req.user,
      uuid: uuid
    });
    var host = req.protocol + "://" + req.get('host');
    res.json(200, {call_url: host + "/calls/" + token});
  });

app.get("/calls", sessions.requireSession, sessions.attachSession,
  function(req, res) {
    var version;

    if (req.headers['content-type'] !== 'application/json') {
      res.json(406, ['application/json']);
      return;
    }

    version = req.body.version;
    if (version === undefined) {
      res.json(400, "version is required");
      return;
    }

    callsStore.find({userMac: hmac(req.user, conf.get('userMacSecret'))},
      function(err, records) {
        if (err) {
          res.json(503, "Service Unavailable");
          return;
        }

        var calls = records.filter(function(record) {
          return record.timestamp >= version;
        }).map(function(record) {
          return {
            apiKey: tokBox.apiKey,
            sessionId: record.sessionId,
            token: record.calleeToken
          };
        });

        res.json(200, {calls: calls});
      });
  });

app.get('/calls/:token', validateToken, function(req, res) {
  res.redirect(conf.get("webAppUrl").replace("{token}", req.param('token')));
});

app.post('/calls/:token', validateToken, function(req, res) {
  tokBox.getSessionTokens(function(err, tokboxInfo) {
    if (err) {
      // XXX Handle TokBox error messages.
      res.json(503, "Service Unavailable");
      return;
    }

    var currentTimestamp = new Date().getTime();

    callsStore.add({
      "uuid": req.token.uuid,
      "userMac": hmac(req.token.user, conf.get("userMacSecret")),
      "sessionId": tokboxInfo.sessionId,
      "calleeToken": tokboxInfo.calleeToken,
      "timestamp": currentTimestamp
    }, function(err, record){
      if (err) {
        // XXX Handle database error messages.
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
        res.json(200, {
          sessionId: tokboxInfo.sessionId,
          token: tokboxInfo.callerToken,
          apiKey: tokBox.apiKey
        });
      });
    });
  });
});

app.listen(conf.get('port'), conf.get('host'));
console.log('Server listening on: ' +
            conf.get('host') + ':' + conf.get('port'));

module.exports = {
  app: app,
  conf: conf,
  urlsStore: urlsStore,
  callsStore: callsStore,
  hmac: hmac,
  validateSimplePushURL: validateSimplePushURL,
  validateToken: validateToken,
  request: request,
  tokBox: tokBox
};
