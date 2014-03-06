/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var express = require('express');
var tokenlib = require('./tokenlib');
var sessions = require("./sessions");
var conf = require('./config.js');
var getStore = require('./stores').getStore;
var pjson = require('../package.json');
var tokBox = conf.get("tokBox");
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
    var token = tokenManager.encode({user: req.user});
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

app.get("/calls", auth.isAuthenticated, function(req, res) {
  callsStore.find({user: req.user}, function(err, records) {
    if (err) {
      res.json(503, "Service Unavailable");
      return;
    }

    var calls = records.map(function(record) {
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
  callsStore: callsStore
};
