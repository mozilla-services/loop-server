/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");

/**
 * Pub/Sub implementation using Redis as a backend.
 **/
function RedisPubSub(options, logError) {
  var client = redis.createClient(
    options.port || 6379,
    options.host || "localhost",
    options.options
  );
  if (options.db) {
    client.select(options.db);
  }

  // Let's report errors when they occur.
  client.on('error', logError);
  client.config('set', 'notify-keyspace-events', 'Ex', function(err) {
    if (err) logError(err);
  });
  return client;
}

module.exports = RedisPubSub;
