/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");


function Storage(options, settings) {
  this._settings = settings;
  this._client = redis.createClient(
    options.host,
    options.port,
    options.options
  );
  if (options.db) {
    this._client.select(options.db);
  }
}

Storage.prototype = {
  revokeURLToken: function(token, callback) {
    var ttl = (token.expires * 60 * 60 * 1000) - new Date().getTime();
    this._client.psetex('urlRevoked.' + token.uuid, ttl, JSON.stringify({
      ttl: ttl,
      uuid: token.uuid
    }), callback);
  },

  isURLRevoked: function(urlId, callback) {
    this._client.get('urlRevoked.' + urlId, function(err, result) {
      callback(err, result ? JSON.parse(result) : result);
    });
  },

  addUserSimplePushURL: function(userMac, simplepushURL, callback) {
    this._client.set('spurl.' + userMac, simplepushURL, callback);
  },

  getUserSimplePushURLs: function(userMac, callback) {
    this._client.get('spurl.' + userMac, function(err, result) {
      var simplePushURL = [];
      if (result !== null) {
        simplePushURL.push({simplepushURL: result});
      }
      callback(err, simplePushURL);
    });
  },

  addUserCall: function(userMac, call, callback) {
    var self = this;
    this._client.setex(
      'call.' + call.callId,
      this._settings.tokenDuration,
      JSON.stringify(call),
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.sadd('userCalls.' + userMac,
                          'call.' + call.callId, callback);
      });
  },

  getUserCalls: function(userMac, callback) {
    var self = this;
    this._client.smembers('userCalls.' + userMac, function(err, members) {
      self._client.mget(members, function(err, calls) {
        if (err) {
          callback(err);
          return;
        }
        var expired = calls.map(function(val, index) {
          return (val === null) ? index : null;
        }).filter(function(val) {
          return val !== null;
        });

        var pendingCalls = calls.filter(function(val) {
          return val !== null;
        }).map(JSON.parse).sort(function(a, b) {
          return a.timestamp - b.timestamp;
        });

        if (expired.length > 0) {
          self._client.srem(expired, function(err, res) {
            callback(null, pendingCalls);
          });
          return;
        }
        callback(null, pendingCalls);
      });
    });
  },

  getCall: function(callId, callback) {
    this._client.get('call.' + callId, function(err, call) {
      callback(err, JSON.parse(call));
    });
  },

  deleteCall: function(callId, callback) {
    this._client.del('call.' + callId, function(err, result) {
      callback(err, result === 0 ? null : result);
    });
  },

  drop: function(callback) {
    this._client.flushdb(callback);
  }
};

module.exports = Storage;
