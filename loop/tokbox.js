/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var crypto = require('crypto');
var request = require('request');
var conf = require('./config').conf;

// Be sure to use the exported OpenTok so we can mock it in the
// tests.
exports.OpenTok = require('opentok');

function TokBox(settings) {
  this.apiKey = settings.apiKey;
  this.apiSecret = settings.apiSecret;
  this.credentials = settings.credentials;
  if (settings.retryOnError === undefined) {
    settings.retryOnError = 3;
  }
  this.retryOnError = settings.retryOnError;
  this.tokenDuration = settings.tokenDuration;
  this.serverURL = settings.apiUrl || "https://api.opentok.com";
  this._opentok = new exports.OpenTok(this.apiKey, settings.apiSecret,
                                      this.serverURL);
}

TokBox.prototype = {
  getSessionTokens: function(options, cb) {
    if (cb === undefined) {
      cb = options;
      options = undefined;
    }

    options = options || {};

    if (options.retry === undefined) {
      options.retry = this.retryOnError;
    }

    var opentok;

    if (this.credentials.hasOwnProperty(options.channel)) {
      opentok = new exports.OpenTok(
        this.credentials[options.channel].apiKey,
        this.credentials[options.channel].apiSecret,
        this.credentials[options.channel].serverURL || this.serverURL
      );
    } else {
      opentok = this._opentok;
    }

    var self = this;
    opentok.createSession({
      mediaMode: 'relayed'
    }, function(err, session) {
        if (err !== null) {
          options.retry--;
          if (options.retry <= 0) {
            cb(err);
            return;
          }
          self.getSessionTokens(options, cb);
          return;
        }
        var sessionId = session.sessionId;
        var now = Math.round(Date.now() / 1000.0);
        var expirationTime = now + self.tokenDuration;
        cb(null, {
          sessionId: sessionId,
          callerToken: self._opentok.generateToken(sessionId, {
            role: 'publisher',
            expireTime: expirationTime
          }),
          calleeToken: self._opentok.generateToken(sessionId, {
            role: 'publisher',
            expireTime: expirationTime
          })
        });
      }
    );
  },
  ping: function(options, cb) {
    if (cb === undefined) {
      cb = options;
      options = undefined;
    }

    options = options || {};
    var timeout = options.timeout;

    console.log(options.timeout, this._opentok.client.c.apiUrl +
        this._opentok.client.c.endpoints.createSession);

    request.post({
      url: this._opentok.client.c.apiUrl +
        this._opentok.client.c.endpoints.createSession,
      form: {"p2p.preference": "enabled"},
      headers: {
        'User-Agent': 'OpenTok-Node-SDK/2.2.3',
        'X-TB-PARTNER-AUTH': this._opentok.client.c.apiKey +
          ':' + this._opentok.client.c.apiSecret
      },
      timeout: timeout
    }, function(err, resp, body) {
      if (err) {
        cb(new Error('The request failed: ' + err));
        return;
      }

      // handle client errors
      if (resp.statusCode === 403) {
        cb(new Error(
          'An authentcation error occurred: (' + resp.statusCode + ') ' + body
        ));
        return;
      }

      // handle server errors
      if (resp.statusCode === 500) {
        cb(new Error(
          'A server error occurred: (' + resp.statusCode + ') ' + body
        ));
        return;
      }

      cb(null);
    });
  }
};

function FakeTokBox(serverURL) {
  this._counter = 0;
  this.serverURL = conf.get("fakeTokBoxURL");
  this.apiKey = "falseApiKey";
}

FakeTokBox.prototype = {
  _urlSafeBase64RandomBytes: function(number_of_bytes) {
    return crypto.randomBytes(number_of_bytes).toString('base64')
                 .replace(/\+/g, '-').replace(/\//g, '_');
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
  getSessionTokens: function(options, cb) {
    if (cb === undefined) {
      cb = options;
      options = {};
    }
    var self = this;
    // Do a real HTTP call to have a realistic behavior.
    request.get({
      url: self.serverURL,
      timeout: options.timeout
    }, function(err) {
      cb(err, {
        sessionId: self._fakeSessionId(),
        callerToken: self._generateFakeToken(),
        calleeToken: self._generateFakeToken()
      });
    });
  },
  ping: function(options, cb) {
    this.getSessionTokens(options, cb);
  }
};


exports.TokBox = TokBox;
exports.FakeTokBox = FakeTokBox;
exports.OpenTok = exports.OpenTok;
exports.request = request;
