/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var crypto = require("crypto");
var sessions = require("client-sessions");
var conf = require('./config').conf;

var DAYS = 24 * 60 * 60 * 1000;
var SESSION_DURATION = conf.get('sessionDuration') * DAYS;

var clientSessions = sessions({
  cookieName: 'loop-session',
  requestKey: 'session',
  secret: conf.get('sessionSecret'),
  duration: SESSION_DURATION,
  proxy: true,
  cookie: {
    path: '/',
    maxAge: SESSION_DURATION,
    ephemeral: false, // when true, cookie expires when the browser closes
    httpOnly: true, // when true, cookie is not accessible from javascript
    // when secure is true, the cookie will only be sent over SSL
    secure: conf.get("useSSL")
  }
});

function attachSession(req, res, next) {
  var uid;

  if (req.session.uid) {
    uid = req.session.uid;
  } else {
    uid = crypto.randomBytes(12).toString('hex');
    req.session.uid = uid;
    req.newSession = true;
  }

  req.user = uid;
  next();
}

function requireSession(req, res, next) {
  if (!req.session.uid) {
    res.send(400, {error: "The request is missing a session cookie"});
    return;
  }
  next();
}

module.exports = {
  attachSession: attachSession,
  requireSession: requireSession,
  clientSessions: clientSessions
};

