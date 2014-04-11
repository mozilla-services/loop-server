/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";


function MemoryStorage(settings, options) {
  var _db = {
    urlsRevocationStore: [],
    urlsStore: [],
    callsStore: []
  };

  function find(name, query, cb) {
    cb(null, _db[name].filter(function(record) {
      return Object.keys(query).every(function(field) {
        return record[field] === query[field];
      });
    }));
  }

  function findOne(name, query, cb) {
    find(name, query, function(err, records) {
      if (records.length === 0) {
        cb(null, null);
        return;
      }
      cb(null, records.shift());
    });
  }

  function deleteItem(name, query, cb) {
    find(name, query, function(err, records) {
      if (records.length === 0) {
        cb(null, false);
        return;
      }

      records.forEach(function(item) {
        var i = _db[name].indexOf(item);
        if (i !== -1) {
          _db[name].splice(i, 1);
        }
      });

      cb(null, true);
    });
  }

  return {
    revokeURLToken: function(token, callback) {
      var ttl = (token.expires * 60 * 60 * 1000) + new Date().getTime();
      var record = {
        uuid: token.uuid,
        ttl: ttl
      };
      deleteItem('urlsRevocationStore', {uuid: token.uuid}, function(){
        _db.urlsRevocationStore.push(record);
        callback(null, record);
      });
    },

    isURLRevoked: function(urlId, callback) {
      findOne('urlsRevocationStore', {uuid: urlId}, function(err, result) {
        var answer = false;
        if (result !== null) {
          answer = result.ttl  > new Date().getTime();
          deleteItem('urlsRevocationStore', {uuid: urlId}, function() {
            callback(err, answer);
          });
          return;
        }
        callback(err, answer);
      });
    },

    addUserSimplePushURL: function(userMac, simplepushURL, callback) {
      deleteItem('urlsStore', {userMac: userMac}, function(){
        var record = {
          userMac: userMac,
          simplepushURL: simplepushURL
        };
        _db.urlsStore.push(record);
        callback(null, record);
      });
    },

    getUserSimplePushURLs: function(userMac, callback) {
      find('urlsStore', {userMac: userMac}, function(err, results) {
        callback(err, results.map(function (val) {
          return val.simplepushURL;
        }));
      });
    },

    addUserCall: function(userMac, call, callback) {
      _db.callsStore.push(call);
      callback(null, call);
    },

    getUserCalls: function(userMac, callback) {
      find('callsStore', {userMac: userMac}, callback);
    },

    getCall: function(callId, callback) {
      findOne('callsStore', {callId: callId}, callback);
    },

    deleteCall: function(callId, callback) {
      deleteItem('callsStore', {callId: callId}, callback);
    },

    drop: function(callback) {
      _db = {
        urlsRevocationStore: [],
        urlsStore: [],
        callsStore: []
      };
      callback();
    },

    ping: function(callback) {
      callback(true);
    }
  };
}

module.exports = MemoryStorage;
