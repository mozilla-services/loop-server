/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");
var async = require("async");
var constants = require("../constants");

var SIMPLE_PUSH_TOPICS = ["calls", "rooms"];

var isUndefined = function(field, fieldName, callback) {
  if (field === undefined) {
    callback(new Error(fieldName + " should not be undefined"));
    return true;
  }
  return false;
}


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


  /**
   * Adds a set of simple push urls to an user (one per simple push topic).
   *
   * @param {String}         userMac, the hmac-ed user, the HMAC of the user;
   * @param {String}         hawkIdHmac, the hmac-ed hawk id of the client;
   * @param {String}         simplePushURLs, an object with a key per SP topic;
   * @param {Function}       A callback that will be called once data had been
   *                         proceced.
   **/
  addUserSimplePushURLs: function(userMac, hawkIdHmac, simplePushURLs, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    var self = this;
    Object.keys(simplePushURLs).forEach(function(topic) {
      if (SIMPLE_PUSH_TOPICS.indexOf(topic) === -1) {
        callback(new Error(topic + " should be one of " +
                           SIMPLE_PUSH_TOPICS.join(", ")));
        return;
      }
    });

    // Remove any previous storage spurl.{userMac} LIST
    // XXX - Bug 1069208 — Remove this two months after 0.13 release
    // (January 2015)
    self._client.del('spurl.' + userMac, function(err) {
      if (err) return callback(err);
      // Manage each session's SP urls in a hash, and maintain a list of sessions
      // with a simple push url per user.
      self._client.hmset('spurls.' + userMac + '.' + hawkIdHmac, simplePushURLs,
        function(err) {
          if (err) return callback(err);
          self._client.sadd('spurls.' + userMac, hawkIdHmac, callback);
        });
    });
  },

  /**
   * Return the simple push URLS for a specified userMac.
   *
   * @param {String}    userMac, the userMac to which the simple push urls had
   *                    been associated;
   * @param {Function}  callback, the callback to call when data had been
   *                    loaded. It will be passed an object with a calls and
   *                    rooms keys, which will each contain a list of simple
   *                    push urls.
   **/
  getUserSimplePushURLs: function(userMac, callback) {
    var self = this;
    if (isUndefined(userMac, "userMac", callback)) return;

    var output = {};
    SIMPLE_PUSH_TOPICS.forEach(function(topic) {
      output[topic] = [];
    });

    // Remove any previous storage spurl.{userHmac} LIST
    // XXX - Bug 1069208 — Remove this two months after 0.13 release
    // (January 2015)
    self._client.lrange(
      'spurl.' + userMac, 0, this._settings.maxSimplePushUrls,
      function(err, SPcallUrls) {
        if (err) return callback(err);
        SPcallUrls.forEach(function(item) {
          if (output.calls.indexOf(item) === -1)
          output.calls.push(item);
        });
        self._client.smembers('spurls.' + userMac, function(err, hawkMacIds) {
          if (err) return callback(err);
          async.map(hawkMacIds, function(hawkMacId, done) {
            self._client.hgetall('spurls.' + userMac + '.' + hawkMacId, done);
          },
          function(err, simplePushMappings) {
            if (err) return callback(err);
            simplePushMappings.forEach(function(mapping) {
              if (mapping) {
                SIMPLE_PUSH_TOPICS.forEach(function(topic) {
                  if (mapping.hasOwnProperty(topic) && output[topic].indexOf(mapping[topic]) === -1) {
                    output[topic].push(mapping[topic]);
                  }
                });
              }
            });
            callback(null, output);
          });
        });
      });
  },


  /**
   * Removes the simple push url of the given user/device.
   *
   * @param {String}         userHmac, the hmac-ed user, the HMAC of the user;
   * @param {String}         hawkIdHmac, the hmac-ed hawk id of the client;
   * @param {Function}       A callback that will be called once data had been
   *                         proceced.
   **/
  removeSimplePushURLs: function(userMac, hawkIdHmac, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    var self = this;
    self._client.srem('spurls.' + userMac, hawkIdHmac, function(err, deleted) {
      if (err) return callback(err);
      if (deleted > 0) {
        self._client.del('spurls.' + userMac + '.' + hawkIdHmac, callback);
      } else {
        callback(null);
      }
    });
  },

  /**
   * Deletes all the simple push URLs of an user.
   *
   * @param String the user mac.
   **/
  deleteUserSimplePushURLs: function(userMac, callback) {
    var self = this;
    if (isUndefined(userMac, "userMac", callback)) return;
    this._client.smembers('spurls.' + userMac, function(err, hawkMacIds) {
      if (err) return callback(err);
      async.each(hawkMacIds, function(hawkHmacId, done) {
        self._client.del('spurls.' + userMac + '.' + hawkHmacId, done);
      }, function(err) {
        if (err) return callback(err);
        self._client.del('spurls.' + userMac, callback);
      });
    });
  },

  addUserCallUrlData: function(userMac, callUrlId, urlData, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(callUrlId, "callUrlId", callback)) return;
    if (isUndefined(urlData.timestamp, "urlData.timestamp", callback)) return;
    var self = this;

    var data = JSON.parse(JSON.stringify(urlData));
    data.userMac = userMac;

    // In that case use setex to add the metadata of the url.
    this._client.setex(
      'callurl.' + callUrlId,
      urlData.expires - parseInt(Date.now() / 1000, 10),
      JSON.stringify(data),
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
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(callUrlId, "callUrlId", callback)) return;
    self._client.sismember(
      'userUrls.' + userMac,
      'callurl.' + callUrlId,
      function(err, res) {
        if (err) {
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
    if (isUndefined(callUrlId, "callUrlId", callback)) return;
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
    if (isUndefined(userMac, "userMac", callback)) return;
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
    if (isUndefined(callUrlId, "callUrlId", callback)) return;
    this._client.del('callurl.' + callUrlId, callback);
  },

  getUserCallUrls: function(userMac, callback) {
    var self = this;
    if (isUndefined(userMac, "userMac", callback)) return;
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
        var expired = urls.map(function(url, index) {
          return (url === null) ? index : null;
        }).filter(function(url) {
          return url !== null;
        });

        var pendingUrls = urls.filter(function(url) {
          return url !== null;
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
    if (isUndefined(userMac, "userMac", callback)) return;
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
    if (isUndefined(userMac, "userMac", callback)) return;
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
    if (isUndefined(userMac, "userMac", callback)) return;
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
        var expired = calls.map(function(call, index) {
          return (call === null) ? index : null;
        }).filter(function(call) {
          return call !== null;
        });

        var pendingCalls = calls.filter(function(call) {
          return call !== null;
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
    if (isUndefined(callId, "callId", callback)) return;
    this._client.pttl('callstate.' + callId, function(err, ttl) {
      if (err) {
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
    if (isUndefined(callId, "callId", callback)) return;
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
    if (isUndefined(callId, "callId", callback)) return;
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

  incrementConnectedCallDevices: function(type, callId, callback) {
    var self = this;
    if (isUndefined(callId, "callId", callback)) return;
    if (isUndefined(type, "type", callback)) return;
    var key = 'call.devices.' + callId + '.' + type;

    self._client.incr(key, function(err) {
      if (err) {
        return callback(err);
      }
      self._client.expire(key, self._settings.callDuration, callback);
    });
  },

  decrementConnectedCallDevices: function(type, callId, callback) {
    var self = this;
    if (isUndefined(callId, "callId", callback)) return;
    if (isUndefined(type, "type", callback)) return;
    var key = 'call.devices.' + callId + '.' + type;

    self._client.decr(key, function(err) {
      if (err) {
        return callback(err);
      }
      self._client.expire(key, self._settings.callDuration, callback);
    });
  },

  getConnectedCallDevices: function(type, callId, callback) {
    var self = this;
    if (isUndefined(callId, "callId", callback)) return;
    if (isUndefined(type, "type", callback)) return;
    var key = 'call.devices.' + callId + '.' + type;

    self._client.get(key, function(err, number) {
      if (err) {
        return callback(err);
      }
      return callback(err, parseInt(number));
    });
  },

  /**
   * Set the call termination reason
   */
  setCallTerminationReason: function(callId, reason, callback) {
    var self = this;
    if (isUndefined(callId, "callId", callback)) return;

    if (reason === undefined) {
      callback(null);
      return;
    }
    self._client.ttl('call.' + callId, function(err, ttl) {
      if (err) {
        callback(err);
        return;
      }
      self._client.setex('callStateReason.' + callId, ttl, reason, callback);
    });
  },

  /**
   * Set the call termination reason
   */
  getCallTerminationReason: function(callId, callback) {
    if (isUndefined(callId, "callId", callback)) return;
    this._client.get('callStateReason.' + callId, callback);
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
    if (isUndefined(callId, "callId", callback)) return;

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
    if (isUndefined(callId, "callId", callback)) return;

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
  setHawkUser: function(userMac, hawkIdHmac, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

    this._client.setex(
      'hawkuser.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      userMac,
      callback
    );
  },

  getHawkUser: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

    this._client.get('hawkuser.' + hawkIdHmac, callback);
  },

  /**
   * Associates an hawk.id (hmac-ed) to an user identifier (encrypted).
   */
  setHawkUserId: function(hawkIdHmac, encryptedUserId, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    if (isUndefined(encryptedUserId, "encryptedUserId", callback)) return;
    this._client.setex(
      'userid.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      encryptedUserId,
      callback
    );
  },

  getHawkUserId: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.get('userid.' + hawkIdHmac, callback);
  },

  deleteHawkUserId: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.del('userid.' + hawkIdHmac, callback);
  },

  setHawkSession: function(hawkIdHmac, authKey, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    if (isUndefined(authKey, "authKey", callback)) return;
    this._client.setex(
      'hawk.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      authKey,
      callback
    );
  },

  touchHawkSession: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

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
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

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
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.del('hawk.' + hawkIdHmac, callback);
  },

  setHawkOAuthToken: function(hawkIdHmac, token, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.set('oauth.token.' + hawkIdHmac, token, callback);
  },

  getHawkOAuthToken: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.get('oauth.token.' + hawkIdHmac, callback);
  },

  setHawkOAuthState: function(hawkIdHmac, state, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.setex(
      'oauth.state.' + hawkIdHmac,
      this._settings.hawkSessionDuration,
      state,
      callback
    );
  },

  getHawkOAuthState: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.get('oauth.state.' + hawkIdHmac, callback);
  },

  clearHawkOAuthState: function(hawkIdHmac, callback) {
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;
    this._client.del('oauth.state.' + hawkIdHmac, callback);
  },

  setUserRoomData: function(userMac, roomToken, roomData, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(roomData.expiresAt, "roomData.expiresAt", callback)) return;
    if (isUndefined(roomData.updateTime, "roomData.updateTime", callback)) return;

    var data = JSON.parse(JSON.stringify(roomData));
    data.roomToken = roomToken;
    var self = this;
    // In that case use setex to add the metadata of the url.
    this._client.setex(
      'room.' + roomToken,
      data.expiresAt - data.updateTime,
      JSON.stringify(data),
      function(err) {
        if (err) {
          callback(err);
          return;
        }
        self._client.sadd(
          'userRooms.' + userMac,
          'room.' + roomToken, callback
        );
      });
  },

  getUserRooms: function(userMac, callback) {
    if (isUndefined(userMac, "userMac", callback)) return;
    var self = this;
    this._client.smembers('userRooms.' + userMac, function(err, members) {
      if (err) {
        callback(err);
        return;
      }

      if (members.length === 0) {
        callback(null, []);
        return;
      }
      self._client.mget(members, function(err, rooms) {
        if (err) {
          callback(err);
          return;
        }
        var expired = rooms.map(function(room, index) {
          return (room === null) ? index : null;
        }).filter(function(room) {
          return room !== null;
        });

        var pendingRooms = rooms.filter(function(room) {
          return room !== null;
        }).map(JSON.parse).sort(function(a, b) {
          return a.updateTime - b.updateTime;
        });

        async.map(pendingRooms, function(room, cb) {
          self._client.keys('roomparticipant.' + room.roomToken + '.*',
            function(err, participantsKeys) {
              if (err) {
                cb(err);
                return;
              }
              room.currSize = participantsKeys.length;
              cb(null, room);
            });
        }, function(err, results) {
          if (err) {
            callback(err);
            return;
          }
          if (expired.length > 0) {
            self._client.srem('userRooms.' + userMac, expired, function(err) {
              if (err) {
                callback(err);
                return;
              }
              callback(null, results);
            });
            return;
          }
          callback(null, results);
        });
      });
    });
  },

  getRoomData: function(roomToken, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    this._client.get('room.' + roomToken, function(err, data) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, JSON.parse(data));
    });
  },

  touchRoomData: function(roomToken, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    var self = this;
    self.getRoomData(roomToken, function(err, data) {
      if (err) {
        callback(err);
        return;
      }
      data.updateTime = parseInt(Date.now() / 1000, 10);
      self._client.setex(
        'room.' + roomToken,
        data.expiresAt - data.updateTime,
        JSON.stringify(data),
        function(err) {
          callback(err, data.updateTime);
        });
    });
  },

  deleteRoomData: function(roomToken, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    var self = this;
    self._client.del('room.' + roomToken, function(err) {
      if (err) {
        callback(err);
        return;
      }
      self.deleteRoomParticipants(roomToken, callback);
    });
  },

  deleteRoomParticipants: function(roomToken, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    var self = this;
    self._client.keys('roomparticipant.' + roomToken + '.*',
      function(err, participantsKeys) {
        if (err) {
          callback(err);
          return;
        }
        if (participantsKeys.length === 0) {
          callback(null);
          return;
        }
        self._client.del(participantsKeys, callback);
      });
  },

  addRoomParticipant: function(roomToken, hawkIdHmac, participantData, ttl,
                               callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

    var data = JSON.parse(JSON.stringify(participantData));
    data.hawkIdHmac = hawkIdHmac;

    this._client.setex('roomparticipant.' + roomToken + '.' + hawkIdHmac, ttl,
     JSON.stringify(data), callback);
  },

  touchRoomParticipant: function(roomToken, hawkIdHmac, ttl, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

    this._client.pexpire('roomparticipant.' + roomToken + '.' + hawkIdHmac,
      ttl * 1000, function(err, result) {
        if (err) {
          callback(err);
          return;
        }
        this._client.pexpire('roomparticipant_access_token.' + roomToken + '.' + hawkIdHmac,
          ttl * 1000, function(err) {
            if (err) {
              callback(err);
              return;
            }
            callback(null, result !== 0);
          });
      }.bind(this));
  },

  deleteRoomParticipant: function(roomToken, hawkIdHmac, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(hawkIdHmac, "hawkIdHmac", callback)) return;

    this._client.del(
      'roomparticipant.' + roomToken + '.' + hawkIdHmac, function(err) {
        if (err) {
          callback(err);
          return;
        }
        this._client.del(
          'roomparticipant_access_token.' + roomToken + '.' + hawkIdHmac, callback);
      }.bind(this)
    );
  },

  getRoomParticipants: function(roomToken, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;

    var self = this;
    self._client.keys('roomparticipant.' + roomToken + '.*',
      function(err, participantsKeys) {
        if (err) {
          callback(err);
          return;
        }
        if (participantsKeys.length === 0) {
          callback(null, []);
          return;
        }
        self._client.mget(participantsKeys, function(err, participants) {
          if (err) {
            callback(err);
            return;
          }
          if (participants === null) {
            callback(null, []);
            return;
          }

          callback(null, participants.filter(function(p) {
            return p !== null;
          }).map(function(participant) {
            return JSON.parse(participant);
          }));
        });
      });
  },

  /**
   * Set the anonymous participant access token.
   */
  setRoomAccessToken: function(roomToken, sessionTokenHmac, ttl, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(sessionTokenHmac, "sessionTokenHmac", callback)) return;

    this._client.psetex(
      'roomparticipant_access_token.' + roomToken + '.' + sessionTokenHmac,
      parseInt(ttl * 1000, 10), "", callback);
  },

  /**
   * Get the anonymous participant access token.
   */
  isRoomAccessTokenValid: function(roomToken, sessionTokenHmac, callback) {
    if (isUndefined(roomToken, "roomToken", callback)) return;
    if (isUndefined(sessionTokenHmac, "sessionTokenHmac", callback)) return;

    this._client.get(
      'roomparticipant_access_token.' + roomToken + '.' + sessionTokenHmac,
      function(err, data) {
        if (err) {
          callback(err);
          return;
        }
        callback(null, data === "");
      });
  },

  drop: function(callback) {
    this._client.flushdb(callback);
  },

  ping: function(callback) {
    var self = this;
    self._client.set('heartbeat', parseInt(Date.now() / 1000, 10),
      function(err) {
        if (err) {
          callback(false);
          return;
        }
        callback(true);
      });
  }
};

module.exports = RedisStorage;
