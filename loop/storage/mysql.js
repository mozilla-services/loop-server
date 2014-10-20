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
    for (var topic in simplePushURLs) {
      if (SIMPLE_PUSH_TOPICS.indexOf(topic) === -1) {
        callback(new Error(topic + " should be one of " +
                           SIMPLE_PUSH_TOPICS.join(", ")));
        return;
      }
    }

    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }

      var query = connection.query("INSERT INTO `simplePushURLs` SET ?", {
        hawkIdHmac: hawkIdHmac,
        userMac: userMac,
        topics: JSON.stringify(simplePushURLs)
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
        "SELECT `topics` FROM `simplePushURLs` WHERE `userMac` = ?", userMac,
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
      var query = connection.query("DELETE FROM `simplePushURLs` WHERE `hawkIdHmac` = ?",
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
      connection.query("DELETE FROM `simplePushURLs` WHERE `userMac` = ?",
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
      var query = connection.query("INSERT INTO `callURLs` SET ?", {
        urlToken: urlToken,
        userMac: userMac,
        callerId: urlData.callerId,
        timestamp: urlData.timestamp,
        issuer: urlData.issuer,
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
        callerId: urlData.callerId,
        issuer: urlData.issuer,
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
        "SELECT `callerId`, `issuer`, `expires`, `timestamp` FROM `callURLs` " +
        "WHERE `expires` > ? AND `urlToken` = ?", [
          now, urlToken], function(err, result) {
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
          }
      );
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
        "SELECT `callerId`, `timestamp`, `issuer`, expires FROM `callURLs` " +
        "WHERE `expires` > ? AND `userMac` = ? ORDER BY timestamp", [
          now, userMac], function(err, results) {
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
    

  drop: function(callback) {
    // callback(null); return;
    this.getConnection(function(err, connection) {
      if (err) {
        callback(err);
        return;
      }
      var query = connection.query("TRUNCATE TABLE `simplePushURLs`", function(err) {
        console.log(query.sql);
        if (err) {
          connection.release();
          callback(err);
          return;
        }
        query = connection.query("TRUNCATE TABLE `callURLs`", function(err) {
          console.log(query.sql);
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
