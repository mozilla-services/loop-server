/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var MongoClient = require("mongodb");


function Storage(settings, options) {
  var _db,
      _coll = {},
      _settings = settings || {},
      _options = options || {};

  if (!_settings.hasOwnProperty('connectionString')) {
    throw new Error("The connectionString setting is required");
  }

  function _ensureConnected(name, cb) {
    if (_coll.hasOwnProperty(name)) {
      cb(null, _coll[name]);
      return;
    }
    MongoClient.connect(_settings.connectionString, function(err, resultDb) {
      if (err) {
        cb(err);
        return;
      }
      _db = resultDb;
      _coll[name] = _db.collection(name);
      cb(null, _coll[name]);
    });
  }

  return {

    get name() {
      return _settings.engine;
    },

    revokeURLToken: function(token, callback) {
      _ensureConnected('urlsRevocationStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        var ttl = (token.expires * 60 * 60 * 1000) + new Date().getTime();
        coll.insert({
          uuid: token.uuid,
          ttl: ttl
        }, function(err, records) {
          callback(err, records ? records[0] : null);
        });
      })
    },
  
    isURLRevoked: function(urlId, callback) {
      _ensureConnected('urlsRevocationStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.findOne({uuid: urlId}, function(err, result) {
          var answer = false;
          if (result !== null) {
            answer = result.ttl  > new Date().getTime();
          }
          if (answer) {
            coll.remove(result, function() {
              callback(err, answer);
            });
            return;
          }
          callback(err, answer);
        });
      });
    },
  
    addUserSimplePushURL: function(userMac, simplepushURL, callback) {
      _ensureConnected("urlsStore", function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.update({
          userMac: userMac
        }, {
          "$set": {
            userMac: userMac,
            simplepushURL: simplepushURL
          }
        }, {
          safe: true,
          upsert: true,
          multi: true
        }, callback);
      });
    },
  
    getUserSimplePushURLs: function(userMac, callback) {
      _ensureConnected('urlsStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.find({userMac: userMac}).toArray(function(err, results) {
          callback(err, results.map(function (val) {
            return val.simplepushURL;
          }));
        });
      });
    },
  
    addUserCall: function(userMac, call, callback) {
      _ensureConnected('callsStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.insert(call, callback);
      });
    },
  
    getUserCalls: function(userMac, callback) {
      _ensureConnected('callsStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.find({userMac: userMac}).toArray(callback);
      });
    },
  
    getCall: function(callId, callback) {
      _ensureConnected('callsStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }

        coll.findOne({callId: callId}, callback);
      });
    },
  
    deleteCall: function(callId, callback) {
      _ensureConnected('callsStore', function(err, coll) {
        if (err) {
          callback(err);
          return;
        }
        var query = {callId: callId};

        coll.find(query).toArray(function(err, records) {
          if (records.length === 0) {
            callback(null, null);
            return;
          }
          coll.remove(query, function(err) {
            if(err) {
              callback(err);
              return;
            }
            callback(null, records);
          });
        });
      });
    },
  
    drop: function(callback) {
      if(_coll) {
        Object.keys(_coll).forEach(function(key) {
          _coll[key].drop();
        });
      }
      callback(null);
    }
  };
}

module.exports = Storage;
