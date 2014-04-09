/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");

function getClient(conf) {
  var client = redis.createClient(conf.host, conf.port, conf.options);
  if (conf.db) {
    client.select(conf.db);
  }
  return client;
}


function Storage(options) {
  this._urlsStore = getClient(
    options.get('urlsStore')
  );

  this._callsStore = getClient(
    options.get('callsStore')
  );

  this._urlsRevocationStore = getClient(
    options.get('urlsRevocationStore')
  );
}

Storage.prototype = {
  revokeURLId: function(token, callback) {
    this._urlsRevocationStore.add({
      uuid: token.uuid,
      ttl: (token.expires * 60 * 60 * 1000) - new Date().getTime()
    }, callback);
  },

  isRevocatedURL: function(urlId, callback) {
    this._urlsRevocationStore.findOne({uuid: urlId}, callback);
  },

  addUserSimplePushURL: function(userMac, simplepushURL, callback) {
    this._urlsStore.updateOrCreate({userMac: userMac}, {
      userMac: userMac,
      simplepushURL: simplepushURL
    }, callback);
  },

  getUserSimplePushURLs: function(userMac, callback) {
    this._urlsStore.find({userMac: userMac}, callback);
  },

  addUserCall: function(userMac, call, callback) {
    this._callsStore.add(call, callback);
  },

  getUserCalls: function(userMac, callback) {
    this._callsStore.find({userMac: userMac}, callback);
  },

  getCall: function(callId, callback) {
    this._callsStore.findOne({callId: callId}, callback);
  },

  deleteCall: function(callId, callback) {
    this._callsStore.delete({callId: callId}, callback);
  },

  drop: function(callback) {
    var self = this;
    self._urlsStore.drop(function() {
      self._callsStore.drop(function() {
        self._urlsRevocationStore.drop(function() {
          callback();
        });
      });
    });
  }
};

module.exports = Storage;
