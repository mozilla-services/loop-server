/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");
var async = require("async");
var constants = require("../constants");

var VALID_TOPICS = ["calls", "rooms"];


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
  addUserSimplePushURLs: function(userHmac, hawkHmacId, simplePushURLs, callback) {
    var self = this;
    // Remove any previous storage spurl.{userHmac} LIST
    // XXX - Remove this two month after 0.13 release
    self._client.del('spurl.' + userHmac, function(err) {
      if (err) {
        callback(err);
        return;
      }

      for (var topic in simplePushURLs) {
        if (VALID_TOPICS.indexOf(topic) === -1) {
          callback(new Error(topic + " should be one of " +
                             VALID_TOPICS.join(", ")));
          return;
        }
      }

      self._client.set('spurl.' + userHmac + '.' + hawkHmacId,
        JSON.stringify(simplePushURLs), function(err) {
          if (err) {
            callback(err);
            return;
          }
          callback(null);
        });
      });
  },

  getUserSimplePushURLs: function(userMac, callback) {
    var self = this;

    var result = {};
    for (var i = 0; i < VALID_TOPICS.length; i++) {
      result[VALID_TOPICS[i]] = [];
    }

    this._client.keys('spurl.' + userMac + '.*', function(err, spurl_keys) {
      if (err) {
        callback(err);
        return;
      }

      if (spurl_keys.length === 0) {
        callback(null, result);
        return;
      }

      self._client.mget(spurl_keys, function(err, simplePushURLsJSONList) {
        if (err) {
          callback(err);
          return;
        }
        var simplePushURLsList = simplePushURLsJSONList.map(function(json) {
          if (json) {
            try {
              return JSON.parse(json);
            } catch (e) {}
          }
          return null;
        }).filter(function (dict) { return dict !== null; });

        for (var i = 0; i < simplePushURLsList.length; i++) {
          var item = simplePushURLsList[i];

          for (var j = 0; j < VALID_TOPICS.length; j++) {
            var topic = VALID_TOPICS[j];
            var sp_topic = item[topic];
            if (sp_topic !== undefined) {
              if (result[topic].indexOf(sp_topic) === -1)
                result[topic].push(sp_topic);
            }
          }
        }
        callback(null, result);
      });
    });
  },

  removeSimplePushURL: function(userMac, hawkHmacId, callback) {
    this._client.del('spurl.' + userMac + '.' + hawkHmacId, callback);
  },

  /**
   * Deletes all the simple push URLs of an user.
   *
   * @param String the user mac.
   **/
  deleteUserSimplePushURLs: function(userMac, callback) {
    var self = this;

    this._client.keys('spurl.' + userMac + '.*', function(err, spurl_keys) {
      if (err) {
        callback(err);
        return;
      }

      if (spurl_keys.length > 0) {
        self._client.del(spurl_keys, callback);
        return;
      }
      callback(null);
    });
  },

  addUserCallUrlData: function(userMac, callUrlId, urlData, callback) {
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
      return;
    } else if (urlData.timestamp === undefined) {
      callback(new Error("urlData should have a timestamp property."));
      return;
    }
    var self = this;
    // In that case use setex to add the metadata of the url.
    this._client.setex(
      'callurl.' + callUrlId,
      urlData.expires - parseInt(Date.now() / 1000, 10),
      JSON.stringify(urlData),
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.sadd(
          'userUrls.' + userMac,
          'callurl.' + callUrlId, callback
        );
      });
  },

  /**
   * Update a call url data.
   *
   * If the call-url doesn't belong to the given user, returns an
   * authentication error.
   **/
  updateUserCallUrlData: function(userMac, callUrlId, newData, callback) {
    var self = this;
    self._client.sismember(
      'userUrls.' + userMac,
      'callurl.' + callUrlId,
      function(err, res) {
        if (err){
          callback(err);
          return;
        }
        if (res === 0) {
          var error = new Error("Doesn't exist");
          error.notFound = true;
          callback(error);
          return;
        }
        // Get and update the existing data.
        self.getCallUrlData(callUrlId, function(err, data) {
          if (err) {
            callback(err);
            return;
          }
          Object.keys(newData).forEach(function(key) {
            data[key] = newData[key];
          });

          self._client.setex(
            'callurl.' + callUrlId,
            data.expires - parseInt(Date.now() / 1000, 10),
            JSON.stringify(data),
            callback
          );
        });
      }
    );
  },

  getCallUrlData: function(callUrlId, callback) {
    this._client.get('callurl.' + callUrlId, function(err, data) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, JSON.parse(data));
    });
  },

  /**
   * Deletes all the call-url data for a given user.
   *
   * Deletes the list of call-urls and all the call-url data for each call.
   *
   * @param String the user mac.
   **/
  deleteUserCallUrls: function(userMac, callback) {
    var self = this;
    self._client.smembers('userUrls.' + userMac, function(err, calls) {
      if (err) {
        callback(err);
        return;
      }
      self._client.del(calls, function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.del('userUrls.' + userMac, callback);
      });
    });
  },

  revokeURLToken: function(callUrlId, callback) {
    this._client.del('callurl.' + callUrlId, callback);
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
          self._client.srem('userUrls.' + userMac, expired, function(err) {
            if (err) {
              callback(err);
              return;
            }
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
    // Clone the args to prevent from modifying it.
    call = JSON.parse(JSON.stringify(call));
    var state = call.callState;
    delete call.callState;
    this._client.setex(
      'call.' + call.callId,
      this._settings.callDuration,
      JSON.stringify(call),
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self.setCallState(call.callId, state, function(err) {
          if (err) {
            callback(err);
            return;
          }
          self._client.sadd('userCalls.' + userMac,
                            'call.' + call.callId, callback);
        });
      });
  },

  /**
   * Deletes all the call data for a given user.
   *
   * Deletes the list of calls.
   *
   * @param String the user mac.
   **/
  deleteUserCalls: function(userMac, callback) {
    var self = this;
    this._client.smembers('userCalls.' + userMac, function(err, members) {
      if (err) {
        callback(err);
        return;
      }
      if (members.length === 0) {
        callback(null);
        return;
      }
      self._client.mget(members, function(err, calls) {
        if (err) {
          callback(err);
          return;
        }
        self._client.del(members, function(err) {
          if (err) {
            callback(err);
            return;
          }
          async.map(calls.map(JSON.parse), function(call, cb) {
            self._client.del('callstate.' + call.callId, cb);
          }, function(err) {
            if (err) {
              callback(err);
              return;
            }
            self._client.del('userCalls.' + userMac, callback);
          });
        });
      });
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

        function getState() {
          async.map(pendingCalls, function(call, cb) {
            self.getCallState(call.callId, function(err, state) {
              if (err) {
                cb(err);
                return;
              }
              call.callState = state;
              cb(null, call);
            });
          }, function(err, results) {
            if (err) {
              callback(err);
              return;
            }
            callback(null, results);
          });
        }

        if (expired.length > 0) {
          self._client.srem('userCalls.' + userMac, expired, function(err) {
            if (err) {
              callback(err);
              return;
            }
            getState();
          });
          return;
        }
        getState();
      });
    });
  },

  /**
   * Returns the expiricy of the call state (in seconds).
   * In case the call is already expired, returns -1.
   **/
  getCallStateTTL: function(callId, callback) {
    this._client.pttl('callstate.' + callId, function(err, ttl) {
      if (err){
        callback(err);
        return;
      }
      if (ttl <= 1) {
        ttl = -1;
      } else {
        ttl = ttl / 1000;
      }
      callback(null, ttl);
    });
  },

  /**
   * Sets the call state to the given state.
   *
   * In case no TTL is given, fetches the one of the call so the expiration
   * is the same for the call and for its state.
   **/
  setCallState: function(callId, state, ttl, callback) {
    var self = this;

    // In case we don't have a TTL, get the one from the call.
    if (ttl === undefined || callback === undefined) {
      if (callback === undefined) callback = ttl;
      this._client.ttl('call.' + callId, function(err, res) {
        if (err) {
          callback(err);
          return;
        }
        self.setCallState(callId, state, res, callback);
      });
      return;
    }

    var validStates = [
      constants.CALL_STATES.INIT,
      constants.CALL_STATES.INIT + ".caller",
      constants.CALL_STATES.INIT + ".callee",
      constants.CALL_STATES.CONNECTING,
      constants.CALL_STATES.CONNECTED + ".caller",
      constants.CALL_STATES.CONNECTED + ".callee",
      constants.CALL_STATES.TERMINATED
    ];

    if (validStates.indexOf(state) === -1) {
      callback(
        new Error(state + " should be one of " + validStates.join(", "))
      );
      return;
    }

    var key = 'callstate.' + callId;

    if(state === constants.CALL_STATES.TERMINATED) {
      self._client.del(key, callback);
      return;
    }

    // Internally, this uses a redis set to be sure we don't store twice the
    // same call state.
    self._client.sadd(key, state, function(err) {
      if (err) {
        callback(err);
        return;
      }
      self._client.pexpire(key, ttl * 1000, callback);
    });
  },

  /**
   * Gets the state of a call.
   *
   * Returns one of "init", "half-initiated", "alerting", "connecting",
   * "half-connected" and "connected".
   **/
  getCallState: function(callId, callback) {
    var self = this;

    // Get the state of a given call. Because of how we store this information
    // (in a redis set), count the number of elements in the set to know what
    // the current state is.
    // State can be (in order) init, alerting, connecting, half-connected,
    // connected. In case of terminate, nothing is stored in the database (the
    // key is dropped).
    self._client.scard('callstate.' + callId, function(err, score) {
      if (err) {
        callback(err);
        return;
      }
      switch (score) {
      case 1:
        callback(null, constants.CALL_STATES.INIT);
        break;
      case 2:
        callback(null, constants.CALL_STATES.HALF_INITIATED);
        break;
      case 3:
        callback(null, constants.CALL_STATES.ALERTING);
        break;
      case 4:
        callback(null, constants.CALL_STATES.CONNECTING);
        break;
      case 5:
        callback(null, constants.CALL_STATES.HALF_CONNECTED);
        break;
      case 6:
        callback(null, constants.CALL_STATES.CONNECTED);
        break;
      default:
        // Ensure a call exists if nothing is stored on this key.
        self.getCall(callId, false, function(err, result) {
          if (err) {
            callback(err);
            return;
          }
          if (result !== null) {
            callback(null, constants.CALL_STATES.TERMINATED);
            return;
          }
          callback(null, null);
        });
      }
    });
  },

  /**
   * Get a call from its id.
   *
   * By default, returns the state of the call. You can set getState to false
   * to deactivate this behaviour.
   **/
  getCall: function(callId, getState, callback) {
    if (callback === undefined) {
      callback = getState;
      getState = true;
    }
    var self = this;
    this._client.get('call.' + callId, function(err, data) {
      if (err) {
        callback(err);
        return;
      }
      var call = JSON.parse(data);
      if (call !== null && getState === true) {
        self.getCallState(callId, function(err, state) {
          if (err) {
            callback(err);
            return;
          }
          call.callState = state;
          callback(err, call);
        });
        return;
      }
      callback(err, call);
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
  setHawkUser: function(userHash, hawkIdHmac, callback) {
    this._client.setex(
      'hawkuser.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      userHash,
      callback
    );
  },

  getHawkUser: function(hawkIdHmac, callback) {
    this._client.get('hawkuser.' + hawkIdHmac, callback);
  },

  /**
   * Associates an hawk.id (hmac-ed) to an user identifier (encrypted).
   */
  setHawkUserId: function(hawkIdHmac, encryptedUserId, callback) {
    this._client.setex(
      'userid.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      encryptedUserId,
      callback
    );
  },

  getHawkUserId: function(hawkIdHmac, callback) {
    this._client.get('userid.' + hawkIdHmac, callback);
  },

  deleteHawkUserId: function(hawkIdHmac, callback) {
    this._client.del('userid.' + hawkIdHmac, callback);
  },

  setHawkSession: function(hawkIdHmac, authKey, callback) {
    this._client.setex(
      'hawk.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      authKey,
      callback
    );
  },

  touchHawkSession: function(hawkIdHmac, callback) {
    var self = this;
    self._client.expire(
      'userid.' + hawkIdHmac,
      self._settings.hawkSessionDuration,
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.expire(
          'hawk.' + hawkIdHmac,
          self._settings.hawkSessionDuration,
          callback
        );
      });
  },

  getHawkSession: function(hawkIdHmac, callback) {
    this._client.get('hawk.' + hawkIdHmac, function(err, key) {
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

  deleteHawkSession: function(hawkIdHmac, callback) {
    this._client.del('hawk.' + hawkIdHmac, callback);
  },

  setHawkOAuthToken: function(hawkIdHmac, token, callback) {
    this._client.set('oauth.token.' + hawkIdHmac, token, callback);
  },

  getHawkOAuthToken: function(hawkIdHmac, callback) {
    this._client.get('oauth.token.' + hawkIdHmac, callback);
  },

  setHawkOAuthState: function(hawkIdHmac, state, callback) {
    this._client.setex(
      'oauth.state.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      state,
      callback
    );
  },

  getHawkOAuthState: function(hawkIdHmac, callback) {
    this._client.get('oauth.state.' + hawkIdHmac, callback);
  },

  clearHawkOAuthState: function(hawkIdHmac, callback) {
    this._client.del('oauth.state.' + hawkIdHmac, callback);
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
