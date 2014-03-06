/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var express = require('express');
var crypto = require('crypto');
var tokenlib = require('./tokenlib');
var sessions = require("./sessions");
var conf = require('./config.js');
var getStore = require('./stores').getStore;
var pjson = require('../package.json');
var tokBox = conf.get("tokBox");
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
  {unique: ["user", "simplepushURL"]}
);

var callsStore = getStore(
  conf.get('callsStore'),
  {unique: ["user", "sessionId"]}
);

var tokBox = new TokBox(conf.get('tokBox'));


function validateSimplePushURL(reqDataObj) {
  if (typeof reqDataObj !== 'object')
    throw new Error('missing request data');

  if (!reqDataObj.hasOwnProperty('simple_push_url'))
    throw new Error('simple_push_url is required');

  if (reqDataObj.simple_push_url.indexOf('http') !== 0)
    throw new Error('simple_push_url should be a valid url');

  return reqDataObj;
}

function validateToken(req, res, next) {
  if (!req.param('token'))
    return res.json(400, "miss the 'token' parameter");

  try {
    req.token = tokenManager.decode(req.param('token'));
  } catch(err) {
    return res.json(400, err);
  }
  next();
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

app.post('/call-url', sessions.requireSession, sessions.attachSession,
  function(req, res) {
    var uuid = crypto.randomBytes(12).toString("hex");
    var token = tokenManager.encode({
      user: req.user,
      uuid: uuid
    });
    var host = req.protocol + "://" + req.get('host');
    return res.json(200, {call_url: host + "/call/" + token});
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
    user: req.user,
    simplepushURL: req.body.simple_push_url
  }, function(err, record){
    if (err) {
      return res.json(503, err);
    }
    return res.json(200, "ok");
  });
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

  callsStore.find({user: req.user}, function(err, records) {
    if (err) {
      res.json(503, "Service Unavailable");
      return;
    }

    var calls = records.filter(function(record) {
      return record.version > version;
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

app.post('/call/:token', validateToken, function(req, res) {
  tokBox.getInfo(function(err, tokboxInfo) {
    if (err) {
      // XXX Verify the error and give a message.
      console.log("tokbox error", err);
      return res.json(503, "Service Unavailable");
    }

    callsStore.add({
      "uuid": req.token.uuid,
      "user": req.token.user,
      "sessionId": tokboxInfo.sessionId,
      "calleeToken": tokboxInfo.calleeToken
    }, function(err, record){
      if (err) {
        // XXX Handle database error messages.
        return res.json(503, "Service Unavailable");
      }
      urlsStore.find({user: req.token.user}, function(err, items) {
        if (err) {
          return res.json(503, "Service Unavailable");
        }
        // Call SimplePush urls.
        items.forEach(function(item) {
          request.put({url: item.simplepushURL});
        });
        return res.json(200, {
          sessionId: tokboxInfo.sessionId,
          token: tokboxInfo.callerToken
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
  request: request,
  tokBox: tokBox,
  validateToken: validateToken
};
