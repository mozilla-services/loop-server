/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");

/**
 * Pub/Sub implementation using Redis as a backend.
 **/
function RedisPubSub(options) {
  this._client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) {
    this._client.select(options.db);
  }
}

RedisPubSub.prototype = {
  subscribe: function(channel, cb) {
    this._client.subscribe(channel, cb);
  },
  unsubscribe: function(channel, cb) {
    this._client.unsubscribe(channel, cb);
  },
  publish: function(channel, message, cb) {
    this._client.publish(channel, cb);
  }
};

module.exports = RedisPubSub;
