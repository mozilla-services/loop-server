/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var redis = require("redis");
var async = require("async");

var MULTI_OPERATIONS = [
  'pttl', 'ttl', 'set', 'setex', 'psetex', 'sadd', 'srem', 'pexpire',
  'expire', 'incr', 'decr', 'hmset', 'hset', 'hsetnx', 'hdel', 'del',
  'hgetall', 'get', 'scard'
];


function createClient() {
  var client = redis.createClient.apply(redis, arguments);

  client.multi = function() {
    var self = this;
    var Multi = function() {
      this.operations = [];
    };

    // Each time an operation is done on a multi, add it to a
    // list to execute.
    MULTI_OPERATIONS.forEach(function(operation) {
      Multi.prototype[operation] = function() {
        this.operations.push([
          operation, Array.prototype.slice.call(arguments)
        ]);
      };
    });

    Multi.prototype.exec = function(callback){
      async.mapSeries(this.operations, function(operation, done){
        var operationName = operation[0];
        var operationArguments = operation[1];

        operationArguments.push(done);
        self[operationName].apply(self, operationArguments);
      }, callback);
    };
    return new Multi();
  };

  return client;
}

module.exports = {
  MULTI_OPERATIONS: MULTI_OPERATIONS,
  createClient: createClient
}
