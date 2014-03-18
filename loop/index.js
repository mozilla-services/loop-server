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
var pjson = require('../package.json');
var tokBox = conf.get("tokBox");
var crypto = require('crypto');
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
var callsStore = getStore(conf.get('callsStore'));

function validateSimplePushURL(reqDataObj) {
  if (typeof reqDataObj !== 'object')
    throw new Error('missing request data');

  if (!reqDataObj.hasOwnProperty('simple_push_url'))
    throw new Error('simple_push_url is required');

  if (reqDataObj.simple_push_url.indexOf('http') !== 0)
    throw new Error('simple_push_url should be a valid url');

  return reqDataObj;
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
    homepage: pjson.homepage
  };

  if (!conf.get("displayVersion")) {
    delete credentials.version;
  }

  return res.json(200, credentials);
});

app.post('/registration', sessions.attachSession, function(req, res) {
  var validated;

  if (req.headers['content-type'] !== 'application/json')
    return res.json(406, ['application/json']);

  try {
    validated = validateSimplePushURL(req.body);
  } catch (err) {
    return res.json(400, {error: err.message});
  }

  urlsStore.add({
    userMac: hmac(req.user, conf.get('userMacSecret')),
    simplepushURL: req.body.simple_push_url
  }, function(err, record){
    if (err) {
      return res.json(503, err);
    }

    return res.json(200, "ok");
  });
});

app.post('/call-url', sessions.requireSession, sessions.attachSession,
  function(req, res) {
    var token = tokenManager.encode({user: req.user});
    var host = req.protocol + "://" + req.get('host');
    return res.json(200, {call_url: host + "/call/" + token});
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
        return record.version >= version;
      }).map(function(record) {
        return {
          apiKey: tokBox.apiKey,
          sessionId: record.sessionId,
          token: record.token
        };
      });

      res.send(200, {calls: calls});
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
  validateSimplePushURL: validateSimplePushURL
};
