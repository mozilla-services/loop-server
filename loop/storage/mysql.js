/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var mysql = require("mysql");

var SIMPLE_PUSH_TOPICS = ["calls", "rooms"];

function MySQLStorage(options, settings) {
  this._settings = settings;
  this._pool = mysql.createPool({
    host     : options.host,
    user     : options.user,
    password : options.password,
    database : options.database
  });
  this.persistentOnly = true;
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
   * Add the SimplePushURLs for the given user session.
   */
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
          console.log(query.sql);
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

      var query = connection.query(
        "SELECT `topics` FROM `sessionSPURLs` WHERE `userMac` = ? " +
        "ORDER BY `timestamp`", userMac,
        function(err, results) {
          console.log(query.sql);
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
          console.log(result);
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
          console.log(query.sql);
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

  addUserCallUrlData: function(userMac, urlToken, urlData, callback) {
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
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
      var query = connection.query("REPLACE INTO `callURLs` SET ?", {
        urlToken: urlToken,
        userMac: userMac,
        callerId: urlData.callerId,
        issuer: urlData.issuer,
        timestamp: urlData.timestamp,
        expires: urlData.expires
      }, function(err) {
        console.log(query.sql);
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
        "UPDATE `callURLs` SET ? WHERE `urlToken` = ? AND `userMac` = ? AND expires > ?", [
          newData, urlToken, userMac, now], function(err, result) {
            console.log(query.sql);
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
        "SELECT `callerId`, `issuer`, `timestamp`, `expires` " +
        "FROM `callURLs` WHERE `expires` > ? AND `urlToken` = ?",
        [now, urlToken], function(err, result) {
          console.log(query.sql);
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
        "DELETE FROM `callURLs` WHERE `urlToken` = ?", urlToken,
        function(err) {
          console.log(query.sql);
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
        "DELETE FROM `callURLs` WHERE `userMac` = ?", userMac,
        function(err) {
          console.log(query.sql);
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
        "FROM `callURLs` WHERE `expires` > ? AND `userMac` = ? " +
        "ORDER BY `timestamp`",
        [now, userMac], function(err, results) {
          results = JSON.parse(JSON.stringify(results.map(function(result) {
            result.callerId = result.callerId || undefined;
            result.issuer = result.issuer || undefined;
            return result;
          })));
          console.log(query.sql, results);
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
          console.log(query.sql);
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
          console.log(query.sql, result);
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
          console.log(query.sql);
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
          console.log(query.sql, result);
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
          console.log(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  touchHawkSession: function(hawkIdHmac, callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var now = parseInt(Date.now() / 1000, 10);
      var expires = now + this._settings.hawkSessionDuration;
      var query = connection.query(
        "UPDATE `hawkSession` SET `expires` = ? WHERE `hawkIdHmac` = ? AND `expires` > ?",
        [expires, hawkIdHmac, now], function(err, result) {
          console.log(query.sql);
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
          console.log(query.sql, result);
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
          console.log(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  setUserRoomData: function(userMac, roomToken, roomData, callback) {
    if (userMac === undefined) {
      callback(new Error("userMac should be defined."));
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
      ownerMac: roomData.ownerMac,
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
          console.log(query.sql);
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
          console.log(query.sql);
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
          console.log(query.sql);
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
          console.log(query.sql);
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
          console.log(query.sql);
          connection.release();
          callback(err);
        });
    });
  },

  getRoomParticipants: function(roomToken, callback) {
    // Mock
    callback(null, []);
  },

  drop: function(callback) {
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("SET autocommit = 0", function(err) {
        // console.log(query.sql);
        if (err) {
          connection.release();
          callback(err);
          return;
        }
        query = connection.query("START TRANSACTION", function(err) {
          // console.log(query.sql);
          if (err) {
            connection.release();
            callback(err);
            return;
          }

          query = connection.query("TRUNCATE TABLE `hawkSession`", function(err) {
            // console.log(query.sql);
            if (err) {
              connection.release();
              callback(err);
              return;
            }

            query = connection.query("TRUNCATE TABLE `callURLs`", function(err) {
              // console.log(query.sql);
              if (err) {
                connection.release();
                callback(err);
                return;
              }

              query = connection.query("TRUNCATE TABLE `sessionSPURLs`", function(err) {
                // console.log(query.sql);
                if (err) {
                  connection.release();
                  callback(err);
                  return;
                }
                query = connection.query("SET FOREIGN_KEY_CHECKS = 0", function(err) {
                  // console.log(query.sql);
                  if (err) {
                    connection.release();
                    callback(err);
                    return;
                  }
                  query = connection.query("TRUNCATE TABLE `room`;", function(err) {
                    // console.log(query.sql);
                    if (err) {
                      connection.release();
                      callback(err);
                      return;
                    }
                    query = connection.query("TRUNCATE TABLE `roomParticipant`",
                      function(err) {
                        // console.log(query.sql);
                        if (err) {
                          connection.release();
                          callback(err);
                          return;
                        }
                        query = connection.query("SET FOREIGN_KEY_CHECKS = 1",
                          function(err) {
                            // console.log(query.sql);
                            if (err) {
                              connection.release();
                              callback(err);
                              return;
                            }
                            query = connection.query("COMMIT",
                              function(err) {
                                // console.log(query.sql);
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
  },

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
