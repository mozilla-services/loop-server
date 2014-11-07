/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var redis = require("redis");
var async = require("async");

// Operations supported by the migration backend.
var SUPPORTED_OPERATIONS = [
  'keys', 'lrange', 'mget', 'sismember', 'smembers', 'get', 'pttl', 'ttl',
  'scard', 'del', 'set', 'setex', 'psetex', 'sadd', 'srem', 'pexpire',
  'expire', 'incr', 'decr'
];
var NOOP = function(c){ c(); };

/**
 * Creates a redis proxy clients, which mimics the same APIs as the ones
 * exposes by the default redis client.
 *
 * The main difference is that this client takes parameters for a new and an
 * old db, and copies data from the old to the new db before asking the new db.
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
  // Do not relay flush operations when using the migration backend.
  Proxy.prototype.flushdb = NOOP;

  /**
   * Copy a key from one database to the other.
   * Keeps the TTL information.
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
        ttl = 0;
      }
      // Redis_client will return buffers if it has buffers as arguments.
      // We want to have a buffer here to dump/restore it properly.
      old_db.dump(new Buffer(key), function(err, dump){
        console.log('dump', new Buffer(key), dump);
        if (err) return callback(err);
        new_db.restore(key, ttl, dump, function(err){
          console.log(err);
          if (err) return callback(err);
          console.log('restore key', key, dump);
          old_db.del(key, function(err){
            console.log('del', key);
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
      console.log('migrate and execute', operation);
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
        console.log('keys detected', key);
        old_db.keys(key, function(err, keys){
          if (err) return callback(err);
          console.log('got keys', keys);
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
    {detect_buffers: true}
  );
  if (options.db) {
    client.select(options.db);
  }
  return client;
}

module.exports = createClient;
