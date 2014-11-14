/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var redis = require("redis");
var async = require("async");
var conf = require('../config').conf;

// Operations supported by the migration backend.
var SUPPORTED_OPERATIONS = [
  'keys', 'lrange', 'mget', 'sismember', 'smembers', 'get', 'pttl', 'ttl',
  'scard', 'set', 'setex', 'psetex', 'sadd', 'srem', 'pexpire',
  'expire', 'incr', 'decr'
];

/**
 * Creates a redis proxy client, exposing the same APIs of the default client.
 *
 * This client takes parameters for a new and an old db, and copies data from
 * the old to the new db before asking the new db to answer the original
 * request.
 *
 * @param {Object}   options, which should have an `oldDB` and a `newDB`
 *                   key, which respects the semantics of a redis client (port,
 *                   host, options).
 *
 * @returns {Object} a client whith the same APIs as the one used in the redis
 *                   backend.
 **/
function createClient(options) {
  var old_db = getClient(options.oldDB);
  var new_db = getClient(options.newDB);

  var Proxy = function(){
    this.old_db = old_db;
    this.new_db = new_db;
  };

  /**
   * Copy a key from one database to the other.
   * Copies also the TTL information.
   *
   * @param {String} key the key to be copied.
   * @param {Function} callback that will be called once the copy is over.
   **/
  var copyKey = function(key, callback) {
    old_db.pttl(key, function(err, ttl){
      if (err) throw err;
      if (ttl === -2){
        // The key doesn't exist.
        callback(null);
        return;
      } else if(ttl === -1){
        // Set the ttl to 0 if there is no TTL for the current key (it means
        // there is no expiration set for it)
        ttl = 0;
      }
      // Redis client will return buffers if it has buffers as arguments.
      // We want to have a buffer here to dump/restore keys using the right
      // encoding (otherwise a "DUMP payload version or checksum are wrong"
      // error is raised).
      old_db.dump(new Buffer(key), function(err, dump){
        if (err) return callback(err);
        new_db.restore(key, ttl, dump, function(err){
          if (err) return callback(err);
          old_db.del(key, function(err){
            if (err) return callback(err);
            callback(null);
          });
        });
      });
    });
  }

  /**
   * Decorator which, given an operation, returns a function that will
   * check if the key exists in the old db, and if so:
   *  - dump from the old db and restore in the new one
   *  - delete the key from the old db
   * And in any case, calls the initial operation on the new db.
   *
   * @param {String} operation — The redis operation name.
   * @return {Function} the function which will do the migration.
   **/
  var migrateAndExecute = function(operation) {
    return function() {
      var originalArguments = arguments;
      var key = arguments[0];
      var callback = arguments[arguments.length - 1];

      // Calls the original command with the arguments passed to this function.
      var callOriginalCommand = function(err){
        if (err) { return callback(err); }
        new_db[operation].apply(new_db, originalArguments);
      }

      // In case we have a keys or a mget command, since we have multiple keys
      // involved, copy all of them before running the original command on the
      // new database.
      if (operation === 'keys') {
        old_db.keys(key, function(err, keys){
          if (err) return callback(err);
          async.each(keys, copyKey, callOriginalCommand);
        });
      } else if (operation === 'mget') {
        async.each(key, copyKey, callOriginalCommand);
      } else {
        copyKey(key, callOriginalCommand);
      }
    };
  }

  // For each of the supported operations, proxy the call the the migration
  // logic.
  SUPPORTED_OPERATIONS.forEach(function(operation) {
    Proxy.prototype[operation] = migrateAndExecute(operation);
  });

  // Do not relay flush operations if we aren't using the TEST environment.
  Proxy.prototype.flushdb = function(callback) {
    if (conf.get('env') !== 'test') {
      callback();
      return
    }
    old_db.flushdb(function(err) {
      if (err) return callback(err);
      new_db.flushdb(function(err) {
        callback(err);
      });
    });
  };

  // For deletion, we just remove from both databases and return the total
  // count of deleted values.
  Proxy.prototype.del = function(key, callback) {
    var deleted = 0;
    old_db.del(key, function(err, number) {
      deleted += number;
      if (err) return callback(err);
      new_db.del(key, function(err, number) {
        deleted += number;
        callback(err, deleted);
      });
    });
  };

  return new Proxy();
}

/**
 * Returns a redis client from the options passed in arguments.
 *
 * @param {Object}   options with a (port, host, options) keys.
 **/
function getClient(options) {
  var client = redis.createClient(
    options.port,
    options.host,
    // This is to return buffers when buffers are sent as params.
    {detect_buffers: true}
  );
  if (options.db) {
    client.select(options.db);
  }
  return client;
}

module.exports = createClient;
