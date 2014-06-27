/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");

function RedisStorage(options, settings) {
  this._settings = settings;
  this._client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) {
    this._client.select(options.db);
  }
}

RedisStorage.prototype = {
  addUserSimplePushURL: function(userMac, simplepushURL, callback) {
    this._client.set('spurl.' + userMac, simplepushURL, callback);
  },

  getUserSimplePushURLs: function(userMac, callback) {
    this._client.get('spurl.' + userMac, function(err, result) {
      var simplePushURL = [];
      if (result !== null) {
        simplePushURL.push(result);
      }
      callback(err, simplePushURL);
    });
  },

  removeSimplePushURL: function(userMac, simplepushURL, callback) {
    this._client.del('spurl.' + userMac, callback);
  },

  addUserCallUrlData: function(userMac, urlData, callback) {
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
      return;
    }
    var self = this;
    // In that case use setex to add the metadata of the url.
    this._client.setex(
      'callurl.' + urlData.urlId,
      urlData.expires - urlData.timestamp,
      JSON.stringify(urlData),
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.sadd('userUrls.' + userMac,
                          'callurl.' + urlData.urlId, callback);
      });
  },

  getCallUrlData: function(urlId, callback) {
    this._client.get('callurl.' + urlId, function(err, url) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, JSON.parse(url));
    });
  },

  revokeURLToken: function(urlId, callback) {
    this._client.del('callurl.' + urlId, callback);
  },

  getUserCallUrls: function(userMac, callback) {
    var self = this;
    this._client.smembers('userUrls.' + userMac, function(err, members) {
      if (err) {
        callback(err);
        return;
      }

      if (members.length === 0) {
        callback(null, []);
        return;
      }
      self._client.mget(members, function(err, urls) {
        if (err) {
          callback(err);
          return;
        }
        var expired = urls.map(function(val, index) {
          return (val === null) ? index : null;
        }).filter(function(val) {
          return val !== null;
        });

        var pendingUrls = urls.filter(function(val) {
          return val !== null;
        }).map(JSON.parse).sort(function(a, b) {
          return a.timestamp - b.timestamp;
        });

        if (expired.length > 0) {
          self._client.srem(expired, function(err, res) {
            callback(null, pendingUrls);
          });
          return;
        }
        callback(null, pendingUrls);
      });
    });
  },

  addUserCall: function(userMac, call, callback) {
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
      return;
    }
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
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
      return;
    }
    var self = this;
    this._client.smembers('userCalls.' + userMac, function(err, members) {
      if (err) {
        callback(err);
        return;
      }

      if (members.length === 0) {
        callback(null, []);
        return;
      }
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
      if (err) {
        callback(err);
        return;
      }
      callback(null, JSON.parse(call));
    });
  },

  deleteCall: function(callId, callback) {
    this._client.del('call.' + callId, function(err, result) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, result !== 0);
    });
  },

  /**
   * Add an hawk id to the list of valid hawk ids for an user.
   **/
  setHawkUser: function(userHash, tokenId, callback) {
    this._client.setex(
      'hawkuser.' + tokenId,
      this._settings.hawkSessionDuration,
      userHash,
      callback
    );
  },

  getHawkUser: function(tokenId, callback) {
    this._client.get('hawkuser.' + tokenId, callback);
  },

  setHawkSession: function(tokenId, authKey, callback) {
    this._client.setex(
      'hawk.' + tokenId,
      this._settings.hawkSessionDuration,
      authKey,
      callback
    );
  },

  touchHawkSession: function(tokenId, callback) {
    this._client.expire(
      'hawk.' + tokenId,
      this._settings.hawkSessionDuration,
      callback
    );
  },

  getHawkSession: function(tokenId, callback) {
    this._client.get('hawk.' + tokenId, function(err, key) {
      if (err) {
        callback(err);
        return;
      }

      var data = {
        key: key,
        algorithm: "sha256"
      };

      callback(null, key === null ? null : data);
    });
  },

  drop: function(callback) {
    this._client.flushdb(callback);
  },

  ping: function(callback) {
    this._client.ping(function(err, value) {
      callback((err === null && value === "PONG"));
    });
  }
};

module.exports = RedisStorage;
