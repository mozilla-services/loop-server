/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var mysql = require("mysql");
var constants = require("../constants");
var sqlLog = require("../logger").sqlLog;

var SIMPLE_PUSH_TOPICS = ["calls", "rooms"];

function MySQLStorage(options, settings) {
  this._settings = settings;
  this._pool = mysql.createPool({
    host     : options.host,
    user     : options.user,
    password : options.password,
    database : options.database
  });
}

MySQLStorage.prototype = {
  /**
   * Select a connection in the connection pooler and return it to the
   * callback.
   *
   * Returns:
   *    @err if an error occured
   *    @connection the connection to be used
   */
  getConnection: function(callback) {
    this._pool.getConnection(callback);
  },


  /**
   * Handle Simple Push URLs
   */

  // Add the SimplePushURLs for the given user session.
  addUserSimplePushURLs: function(userMac, hawkIdHmac, simplePushURLs, callback) {
    var self = this;
    for (var topic in simplePushURLs) {
      if (SIMPLE_PUSH_TOPICS.indexOf(topic) === -1) {
        callback(new Error(topic + " should be one of " +
                           SIMPLE_PUSH_TOPICS.join(", ")));
        return;
      }
    }

    self.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var expires = now + self._settings.hawkSessionDuration;

      var query = connection.query(
        "REPLACE INTO `sessionSPURLs` SET ? ",
        {
          hawkIdHmac: hawkIdHmac,
          userMac: userMac,
          topics: JSON.stringify(simplePushURLs),
          timestamp: now,
          expires: expires
        }, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getUserSimplePushURLs: function(userMac, callback) {
    var result = {};
    for (var i = 0; i < SIMPLE_PUSH_TOPICS.length; i++) {
      result[SIMPLE_PUSH_TOPICS[i]] = [];
    }

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `topics` FROM `sessionSPURLs` WHERE `userMac` = ? " +
        "AND `expires` > ? " +
        "ORDER BY `timestamp`", [userMac, now],
        function(err, results) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          results.forEach(function(item) {
            item = JSON.parse(item.topics);
            for (var i = 0; i < SIMPLE_PUSH_TOPICS.length; i++) {
              var topic = SIMPLE_PUSH_TOPICS[i];
              var sp_topic = item[topic];
              if (sp_topic !== undefined) {
                if (result[topic].indexOf(sp_topic) === -1)
                  result[topic].push(sp_topic);
              }
            }
          });
          callback(null, result);
        });
    });
  },

  removeSimplePushURLs: function(userMac, hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("DELETE FROM `sessionSPURLs` WHERE `hawkIdHmac` = ?",
        hawkIdHmac, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  /**
   * Deletes all the simple push URLs of an user.
   *
   * @param String the user mac.
   **/
  deleteUserSimplePushURLs: function(userMac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      connection.query("DELETE FROM `sessionSPURLs` WHERE `userMac` = ?",
        userMac, function(err) {
          connection.release();
          callback(err);
        });
    });
  },


  /**
   * Handle User Call URL data
   */

  addUserCallUrlData: function(userMac, urlToken, urlData, callback) {
    if (userMac === undefined) {
      callback(new Error("[MySQL] callUrlData: userMac should be defined."));
      return;
    } else if (urlData.timestamp === undefined) {
      callback(new Error("urlData should have a timestamp property."));
      return;
    }

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("REPLACE INTO `callURL` SET ?", {
        urlToken: urlToken,
        userMac: userMac,
        callerId: urlData.callerId,
        issuer: urlData.issuer,
        timestamp: urlData.timestamp,
        expires: urlData.expires
      }, function(err) {
        sqlLog(query.sql);
        connection.release();
        callback(err);
      });
    });
  },

  /**
   * Update a call url data.
   *
   * If the call-url doesn't belong to the given user, returns an
   * authentication error.
   **/
  updateUserCallUrlData: function(userMac, urlToken, urlData, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var newData = JSON.parse(JSON.stringify({
        callerId: urlData.callerId || undefined,
        issuer: urlData.issuer || undefined,
        expires: urlData.expires
      }));

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "UPDATE `callURL` SET ? WHERE `urlToken` = ? AND `userMac` = ? AND expires > ?", [
          newData, urlToken, userMac, now], function(err, result) {
            sqlLog(query.sql);
            if (result.affectedRows === 0) {
              var error = new Error("Doesn't exist");
              error.notFound = true;
              callback(error);
              return;
            }
            connection.release();
            callback(err);
          }
      );
    });
  },

  getCallUrlData: function(urlToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `userMac`, `callerId`, `issuer`, `timestamp`, `expires` " +
        "FROM `callURL` WHERE `expires` > ? AND `urlToken` = ?",
        [now, urlToken], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }

          if (result.length !== 0) {
            result = result[0];
            result.callerId = result.callerId || undefined;
            result.issuer = result.issuer || undefined;
            result = JSON.parse(JSON.stringify(result));
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  revokeURLToken: function(urlToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `callURL` WHERE `urlToken` = ?", urlToken,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
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
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `callURL` WHERE `userMac` = ?", userMac,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getUserCallUrls: function(userMac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `callerId`, `issuer`, `timestamp`, `expires` " +
        "FROM `callURL` " +
        "WHERE `expires` > ? AND `userMac` = ? " +
        "ORDER BY `timestamp`",
        [now, userMac], function(err, results) {
          results = JSON.parse(JSON.stringify(results.map(function(result) {
            result.callerId = result.callerId || undefined;
            result.issuer = result.issuer || undefined;
            return result;
          })));
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          callback(null, results);
        });
    });
  },


  /**
   * Handle User Call Data
   */

  addUserCall: function(userMac, call, callback) {
    if (userMac === undefined) {
      callback(new Error("[MySQL] addUserCall: userMac should be defined."));
      return;
    }

    var now = parseInt(Date.now() / 1000, 10);
    var expires = now + this._settings.callDuration;

    var newData = {
      callId: call.callId,
      userMac: userMac,
      callType: call.callType,
      callState: call.callState,
      callerId: call.callerId,
      calleeFriendlyName: call.calleeFriendlyName || null,
      sessionId: call.sessionId,
      apiKey: call.apiKey,
      calleeToken: call.calleeToken,
      wsCallerToken: call.wsCallerToken,
      wsCalleeToken: call.wsCalleeToken,
      callToken: call.callToken || null,
      urlCreationDate: call.urlCreationDate || null,
      timestamp: now,
      expires: expires
    };

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("REPLACE INTO `call` SET ?", newData,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
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
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("DELETE FROM `call` WHERE `userMac` = ?",
        userMac, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getUserCalls: function(userMac, callback) {
    if (userMac === undefined) {
      callback(new Error("[MySQL] getUserCalls: userMac should be defined."));
      return;
    }
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `callId`, `callType`, `callState`, `callerId`, `timestamp`," +
        " `calleeFriendlyName`, `sessionId`, `apiKey`, `calleeToken`, `userMac`," +
        " `wsCallerToken`, `wsCalleeToken`, `callToken`, `urlCreationDate` " +
        "FROM `call` " +
        "WHERE `expires` > ? AND `userMac` = ? " +
        "ORDER BY `timestamp`, `callId`",
        [now, userMac], function(err, results) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          results = results.map(function(result) {
            result.callerId = result.callerId || undefined;
            result.calleeFriendlyName = result.calleeFriendlyName || undefined;
            result.callToken = result.callToken || undefined;
            result.urlCreationDate = result.urlCreationDate || undefined;
            return JSON.parse(JSON.stringify(result));
          });
          callback(null, results);
        });
    });
  },

  /**
   * Sets the call state to the given state.
   *
   * In case no TTL is given, fetches the one of the call so the expiration
   * is the same for the call and for its state.
   **/
  setCallState: function(callId, state, ttl, callback) {
    // In case we don't have a TTL, get the one from the call.
    if (callback === undefined) {
      callback = ttl;
      ttl = undefined;
    }

    var now = parseInt(Date.now() / 1000, 10);
    var expires;
    if (ttl !== undefined) {
      expires = parseInt(now + ttl, 10);
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

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "UPDATE `call` SET ? " +
        "WHERE `expires` > ? AND `callId` = ? " +
        "ORDER BY `timestamp`, `callId`",
        [
          JSON.parse(
            JSON.stringify({
              callState: state,
              expires: expires
            })
          ),
          now, callId
        ], function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  /**
   * Gets the state of a call.
   *
   * Returns one of "init", "half-initiated", "alerting", "connecting",
   * "half-connected" and "connected".
   **/
  getCallState: function(callId, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT callState FROM `call` " +
        "WHERE `expires` > ? AND `callId` = ? " +
        "ORDER BY `timestamp`, `callId`",
        [now, callId], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }

          if (result.length !== 0) {
            result = result[0].callState;
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  /**
   * Set the call termination reason
   */
  setCallTerminationReason: function(callId, reason, callback) {
    if (reason === undefined) {
      callback(null);
      return;
    }

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      // We don't check expires there on purpose
      var query = connection.query(
        "UPDATE `call` SET `callTerminationReason` = ? " +
        "WHERE `callId` = ? ",
        [reason, callId], function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  /**
   * Set the call termination reason
   */
  getCallTerminationReason: function(callId, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      // We don't check expires there on purpose
      var query = connection.query(
        "SELECT callTerminationReason FROM `call` " +
        "WHERE `callId` = ? ",
        callId, function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }

          if (result.length !== 0) {
            result = result[0].callTerminationReason;
          } else {
            result = null;
          }
          callback(null, result);
        });
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

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `callId`, `callType`, `callState`, `callerId`, `userMac`," +
        " `calleeFriendlyName`, `sessionId`, `apiKey`, `calleeToken`," +
        " `wsCallerToken`, `wsCalleeToken`, `callToken`, `urlCreationDate`, `timestamp` " +
        "FROM `call` WHERE `expires` > ? AND `callId` = ?",
        [now, callId], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }

          if (result.length !== 0) {
            result = result[0];
            result.callerId = result.callerId || undefined;
            result.calleeFriendlyName = result.calleeFriendlyName || undefined;
            result.callToken = result.callToken || undefined;
            result.urlCreationDate = result.urlCreationDate || undefined;
            result = JSON.parse(JSON.stringify(result));
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  deleteCall: function(callId, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `call` WHERE `callId` = ?", callId,
        function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (result.affectedRows === 0) {
            result = false;
          } else {
            result = true;
          }
          callback(err, result);
        });
    });
  },


  /**
   * Handle User Hawk Session
   */

  /**
   * Add an hawk id to the list of valid hawk ids for an user.
   **/
  setHawkUser: function(userMac, hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "UPDATE `hawkSession` SET `userMac` = ? WHERE `hawkIdHmac` = ?",
        [userMac, hawkIdHmac], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (result.affectedRows === 0) {
            var error = new Error("Doesn't exist");
            error.notFound = true;
            callback(error);
            return;
          }
          callback(err);
        }
      );
    });
  },

  getHawkUser: function(hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `userMac` FROM `hawkSession` " +
        "WHERE `expires` > ? AND `hawkIdHmac` = ?",
        [now, hawkIdHmac], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          if (result.length !== 0) {
            result = result[0].userMac;
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  /**
   * Associates an hawk.id (hmac-ed) to an user identifier (encrypted).
   */
  setHawkUserId: function(hawkIdHmac, encryptedUserId, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "UPDATE `hawkSession` SET `encryptedUserId` = ? WHERE `hawkIdHmac` = ?",
        [encryptedUserId, hawkIdHmac], function(err, result) {
          sqlLog(query.sql);
          if (result.affectedRows === 0) {
            var error = new Error("Doesn't exist");
            error.notFound = true;
            callback(error);
            return;
          }
          connection.release();
          callback(err);
        }
      );
    });
  },

  getHawkUserId: function(hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `encryptedUserId` FROM `hawkSession` " +
        "WHERE `expires` > ? AND `hawkIdHmac` = ?",
        [now, hawkIdHmac], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          if (result.length !== 0) {
            result = result[0].encryptedUserId;
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  setHawkSession: function(hawkIdHmac, authKey, callback) {
    var now = parseInt(Date.now() / 1000, 10);
    var expires = now + this._settings.hawkSessionDuration;
    var newData = {
      hawkIdHmac: hawkIdHmac,
      authKey: authKey,
      timestamp: now,
      expires: expires
    };

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "REPLACE INTO `hawkSession` SET ? ", newData, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  touchHawkSession: function(hawkIdHmac, callback) {
    var self = this;
    self.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var expires = now + self._settings.hawkSessionDuration;
      var query = connection.query(
        "UPDATE `hawkSession` SET `expires` = ? WHERE `hawkIdHmac` = ? AND `expires` > ?",
        [expires, hawkIdHmac, now], function(err, result) {
          sqlLog(query.sql);
          if (result.affectedRows === 0) {
            var error = new Error("Doesn't exist");
            error.notFound = true;
            callback(error);
            return;
          }
          connection.release();
          callback(err);
        }
      );
    });
  },

  getHawkSession: function(hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT `authKey` FROM `hawkSession` " +
        "WHERE `expires` > ? AND `hawkIdHmac` = ?",
        [now, hawkIdHmac], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          if (result.length !== 0) {
            result = {
              key: result[0].authKey,
              algorithm: "sha256"
            };
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  deleteHawkSession: function(hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `hawkSession` WHERE `hawkIdHmac` = ?", hawkIdHmac,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },


  /**
   * Handle User Room data
   */

  setUserRoomData: function(userMac, roomToken, roomData, callback) {
    if (userMac === undefined) {
      callback(new Error("[MySQL] setUserRoomData: userMac should be defined."));
      return;
    } else if (roomToken === undefined) {
      callback(new Error("roomToken should be defined."));
      return;
    } else if (roomData.expiresAt === undefined) {
      callback(new Error("roomData should have an expiresAt property."));
      return;
    } else if (roomData.updateTime === undefined) {
      callback(new Error("roomData should have an updateTime property."));
      return;
    }

    var newData = {
      roomToken: roomToken,
      roomName: roomData.roomName,
      roomOwner: roomData.roomOwner,
      creationTime: roomData.creationTime,
      expiresAt: roomData.expiresAt,
      ownerMac: userMac,
      sessionId: roomData.sessionId,
      apiKey: roomData.apiKey,
      expiresIn: roomData.expiresIn,
      updateTime: roomData.updateTime,
      maxSize: roomData.maxSize
    };

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "REPLACE INTO `room` SET ? ", newData, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getUserRooms: function(userMac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT r.*, COUNT(p.*) as currSize FROM `room` as r " +
        "LEFT JOIN `roomParticipant` as p " +
        "ON p.roomToken = r.roomToken  AND p.expiresAt > ? " +
        "WHERE `r`.`expiresAt` > ? AND `r`.`ownerMac` = ? " +
        "GROUP BY r.roomToken" +
        "ORDER BY `r`.`creationTime`",
        [now, now, userMac], function(err, results) {
          results = JSON.parse(JSON.stringify(results));
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          callback(null, results);
        });
    });
  },

  getRoomData: function(roomToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT * FROM `room` WHERE `expiresAt` > ? AND `roomToken` = ?",
        [now, roomToken], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }

          if (result.length !== 0) {
            result = JSON.parse(JSON.stringify(result[0]));
          } else {
            result = null;
          }
          callback(null, result);
        });
    });
  },

  touchRoomData: function(roomToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "UPDATE `room` SET `updateTime` = ? " +
        "WHERE `roomToken` = ? AND `expiresAt` > ?",
        [now, roomToken, now], function(err, result) {
          sqlLog(query.sql);
          if (result.affectedRows === 0) {
            var error = new Error("Doesn't exist");
            error.notFound = true;
            callback(error);
            return;
          }
          connection.release();
          callback(err);
        }
      );
    });
  },

  deleteRoomData: function(roomToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `room` WHERE `roomToken` = ?", roomToken,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },


  /**
   * Handle Room participants
   */

  deleteRoomParticipants: function(roomToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `roomParticipant` WHERE `roomToken` = ?", roomToken,
        function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  addRoomParticipant: function(roomToken, hawkIdHmac, participantData, ttl,
                               callback) {
    var now = parseInt(Date.now() / 1000, 10);
    var expiresIn = parseInt(ttl, 10);
    var expires = now + expiresIn;
    var newData = {
      roomToken: roomToken,
      hawkIdHmac: hawkIdHmac,
      id: participantData.id,
      userMac: participantData.userIdHmac,
      clientMaxSize: participantData.clientMaxSize,
      displayName: participantData.displayName,
      encryptedUserId: participantData.account,
      expiresIn: expiresIn,
      timestamp: now,
      expires: expires
    };

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "REPLACE INTO `roomParticipant` SET ? ", newData, function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  touchRoomParticipant: function(roomToken, hawkIdHmac, ttl, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var expires = parseInt(now + ttl, 10);

      var query = connection.query(
        "UPDATE `roomParticipant` SET `expires` =  ? " +
        "WHERE `roomToken` = ? AND `hawkIdHmac` = ? AND `expires` > ?",
        [expires, roomToken, hawkIdHmac, now], function(err, result) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }
          callback(null, result.affectedRows !== 0);
        });
    });
  },

  deleteRoomParticipant: function(roomToken, hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query(
        "DELETE FROM `roomParticipant` " +
        "WHERE `roomToken` = ? AND `hawkIdHmac` = ?",
        [roomToken, hawkIdHmac], function(err) {
          sqlLog(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getRoomParticipants: function(roomToken, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var query = connection.query(
        "SELECT * FROM `roomParticipant` " +
        "WHERE `expires` > ? AND `roomToken` = ?" +
        "ORDER BY `timestamp`, `id`",
        [now, roomToken], function(err, results) {
          sqlLog(query.sql);
          connection.release();
          if (err) {
            callback(err);
            return;
          }


          results = results.map(function(item) {
            return {
              hawkIdHmac: item.hawkIdHmac,
              id: item.id,
              userIdHmac: item.userMac,
              clientMaxSize: item.clientMaxSize,
              displayName: item.displayName,
              account: item.encryptedUserId
            };
          });

          callback(null, results);
        });
    });
  },


  /**
   * Handle DB cleanup after each test
   */

  drop: function(callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("SET autocommit = 0", function(err) {
        sqlLog(query.sql);
        if (err) {
          connection.release();
          callback(err);
          return;
        }
        query = connection.query("START TRANSACTION", function(err) {
          sqlLog(query.sql);
          if (err) {
            connection.release();
            callback(err);
            return;
          }

          query = connection.query("TRUNCATE TABLE `hawkSession`", function(err) {
            sqlLog(query.sql);
            if (err) {
              connection.release();
              callback(err);
              return;
            }

            query = connection.query("SET FOREIGN_KEY_CHECKS = 0", function(err) {
              sqlLog(query.sql);
              if (err) {
                connection.release();
                callback(err);
                return;
              }

              query = connection.query("TRUNCATE TABLE `sessionSPURLs`", function(err) {
                sqlLog(query.sql);
                if (err) {
                  connection.release();
                  callback(err);
                  return;
                }
                query = connection.query("TRUNCATE TABLE `callURL`", function(err) {
                  sqlLog(query.sql);
                  if (err) {
                    connection.release();
                    callback(err);
                    return;
                  }
                  query = connection.query("TRUNCATE TABLE `call`", function(err) {
                    sqlLog(query.sql);
                    if (err) {
                      connection.release();
                      callback(err);
                      return;
                    }
                    query = connection.query("TRUNCATE TABLE `room`;", function(err) {
                      sqlLog(query.sql);
                      if (err) {
                        connection.release();
                        callback(err);
                        return;
                      }
                      query = connection.query("TRUNCATE TABLE `roomParticipant`",
                        function(err) {
                          sqlLog(query.sql);
                          if (err) {
                            connection.release();
                            callback(err);
                            return;
                          }
                          query = connection.query("SET FOREIGN_KEY_CHECKS = 1",
                            function(err) {
                              sqlLog(query.sql);
                              if (err) {
                                connection.release();
                                callback(err);
                                return;
                              }
                              query = connection.query("COMMIT",
                                function(err) {
                                  sqlLog(query.sql);
                                  if (err) {
                                    connection.release();
                                    callback(err);
                                    return;
                                  }

                                  connection.release();
                                  callback();
                                });
                            });
                        });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  },


  /**
   * Handle ping for the heartbeat endpoint
   */

  ping: function(callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      connection.ping(function(err) {
        connection.release();
        if (err) {
          callback(false);
        } else {
          callback(true);
        }
      });
    });
  }
};


module.exports = MySQLStorage;
