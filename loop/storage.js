/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function Storage(options) {
  this._urlsStore = getStore(
    options.get('urlsStore'),
    {unique: ["userMac", "simplepushURL"]}
  );

  this._callsStore = getStore(
    options.get('callsStore'),
    {unique: ["userMac", "sessionId"]}
  );

  this._urlsRevocationStore = getStore(
    options.get('urlsRevocationStore'),
    {unique: ["uuid"]}
  );
}

Storage.prototype = {
  revokeUrlId: function(urlId, callback) {
  },

  isRevocatedURL: function(urlId, callback) {
  },

  addUserSimplePushURL: function(user, spURL, callback) {
  },

  getUserSimplePushURLs: function(user, callback) {
  },

  addUserCall: function(user, call, callback) {
  },

  getUserCalls: function(user, callback) {
  },

  getCall: function(callId, callback) {
  },

  deleteCall: function(callId, callback) {
  }
};
