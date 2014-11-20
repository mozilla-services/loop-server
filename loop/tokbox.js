/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var randomBytes = require('crypto').randomBytes;
var request = require('request');
var conf = require('./config').conf;
var time = require('./utils').now;

// Be sure to use the exported OpenTok so we can mock it in the
// tests.
exports.OpenTok = require('opentok');

function TokBox(settings) {
  this.credentials = settings.credentials;
  if (settings.retryOnError === undefined) {
    settings.retryOnError = 3;
  }
  this.retryOnError = settings.retryOnError;
  this.tokenDuration = settings.tokenDuration;
  this._opentok = {};
  for (var channel in this.credentials) {
    this._opentok[channel] = new exports.OpenTok(
      this.credentials[channel].apiKey,
      this.credentials[channel].apiSecret, {
        apiUrl: this.credentials[channel].apiUrl || conf.get("tokBox").apiUrl,
        timeout: settings.timeout
      }
    );
  }
}

TokBox.prototype = {

  getSession: function(options, callback) {
    if (callback === undefined) {
      callback = options;
      options = undefined;
    }

    options = options || {};

    if (options.retry === undefined) {
      options.retry = this.retryOnError;
    }

    var opentok;

    if (this.credentials.hasOwnProperty(options.channel)) {
      opentok = this._opentok[options.channel];
    } else {
      opentok = this._opentok["default"];
    }

    var self = this;
    opentok.createSession({
      mediaMode: options.mediaMode || "relayed"
    }, function(err, session) {
        if (err !== null) {
          options.retry--;
          if (options.retry <= 0) {
            callback(err);
            return;
          }
          self.getSession(options, callback);
          return;
        }
        callback(null, session, opentok);
    });
  },
  getSessionToken: function(sessionId) {
    var now = time();
    var expirationTime = now + this.tokenDuration;

    return this._opentok["default"].generateToken(
      sessionId, {
        role: 'publisher',
        expireTime: expirationTime
      }
    );
  },
  getSessionTokens: function(options, callback) {
    var self = this;

    if (callback === undefined) {
      callback = options;
      options = {};
    }

    options.mediaMode = options.mediaMode || "relayed";

    this.getSession(options, function(err, session, opentok) {
      if (err) return callback(err);
      var sessionId = session.sessionId;
      var now = time();
      var expirationTime = now + self.tokenDuration;
      callback(null, {
        apiKey: opentok.apiKey,
        sessionId: sessionId,
        callerToken: opentok.generateToken(sessionId, {
          role: 'publisher',
          expireTime: expirationTime
        }),
        calleeToken: opentok.generateToken(sessionId, {
          role: 'publisher',
          expireTime: expirationTime
        })
      });
    });
  },
  ping: function(options, callback) {
    if (callback === undefined) {
      callback = options;
      options = undefined;
    }

    options = options || {};
    var timeout = options.timeout;

    var opentok = new exports.OpenTok(
      this.credentials.default.apiKey,
      this.credentials.default.apiSecret, {
        apiUrl: this.credentials.default.apiUrl || conf.get("tokBox").apiUrl,
        timeout: timeout
      }
    );

    opentok.createSession({
      mediaMode: 'relayed'
    }, function(err) {
      if (err !== null) {
        callback(err);
        return;
      }
      callback(null);
    });
  }
};

function FakeTokBox() {
  this._counter = 0;
  this.serverURL = conf.get("fakeTokBoxURL");
  this.apiKey = "falseApiKey";
}

FakeTokBox.prototype = {
  _urlSafeBase64RandomBytes: function(number_of_bytes) {
    return randomBytes(number_of_bytes).toString('base64')
                 .replace(/\+/g, '-').replace(/\//g, '_');
  },

  _fakeApiKey: function() {
    return "4468744";
  },

  _fakeSessionId: function() {
    this._token = 0;
    this._counter += 1;
    return this._counter + '_' + this._urlSafeBase64RandomBytes(51);

  },

  _generateFakeToken: function() {
    this._token += 1;
    return 'T' + this._token + '==' + this._urlSafeBase64RandomBytes(293);
  },

  getSession: function(options, callback) {
    if (callback === undefined) {
      callback = options;
      options = {};
    }

    var self = this;
    // Do a real HTTP call to have a realistic behavior.
    request.get({
      url: self.serverURL,
      timeout: options.timeout
    }, function(err) {
      callback(err, self._fakeSessionId(), {apiKey: self._fakeApiKey()});
    });
  },

  getSessionToken: function() {
    return this._generateFakeToken();
  },

  getSessionTokens: function(options, callback) {
    if (callback === undefined) {
      callback = options;
      options = {};
    }
    var self = this;
    // Do a real HTTP call to have a realistic behavior.
    request.get({
      url: self.serverURL,
      timeout: options.timeout
    }, function(err) {
      callback(err, {
        apiKey: self._fakeApiKey(),
        sessionId: self._fakeSessionId(),
        callerToken: self._generateFakeToken(),
        calleeToken: self._generateFakeToken()
      });
    });
  },
  ping: function(options, callback) {
    this.getSessionTokens(options, callback);
  }
};


exports.TokBox = TokBox;
exports.FakeTokBox = FakeTokBox;
exports.OpenTok = exports.OpenTok;
exports.request = request;
