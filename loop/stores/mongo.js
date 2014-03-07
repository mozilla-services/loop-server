/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var MongoClient = require('mongodb').MongoClient;

/**
 * Simple MongoDB key/value store. Handles a single collection to store data.
 *
 * Available options:
 *
 * - {Array} unique: list of fields which compound value should be unique.
 *
 * @param  {Object} settings    Settings object
 * @param  {Object} options     Options object
 * @return {MongoStore}
 */
module.exports = function MongoStore(settings, options) {
  "use strict";

  var _db,
      _coll,
      _options = options || {unique: []},
      _settings = settings || {};

  if (!_settings.hasOwnProperty('connectionString')) {
    throw new Error("The connectionString setting is required");
  }

  if (!_settings.hasOwnProperty('name')) {
    throw new Error("The name setting is required");
  }


  /**
   * Ensures the database is connected, sends back an instance of the
   * db. Creates defined unique index if any.
   *
   * @private
   * @param  {Function} cb Callback(err, collection)
   */
  function _ensureConnected(cb) {
    if (_coll) {
      cb(null, _coll);
      return;
    }
    MongoClient.connect(_settings.connectionString, function(err, resultDb) {
      if (err) {
        cb(err);
        return;
      }
      _db = resultDb;
      _coll = _db.collection(_settings.name);
      if (!Array.isArray(_options.unique) || _options.unique.length === 0) {
        cb(null, _coll);
        return;
      }
      var defs = _options.unique.reduce(function(obj, field) {
        obj[field] = 1;
        return obj;
      }, {});
      _coll.ensureIndex(defs, {unique: true}, function(err) {
        if (err) {
          cb(err);
          return;
        }
        cb(null, _coll);
      });
    });
  }

  return {
    /**
     * Returns current name value (read only).
     *
     * @return {String}
     */
    get name() {
      return _settings.name;
    },

    /**
     * Adds a single record to the collection.
     *
     * @param {Object}   record Record Object
     * @param {Function} cb     Callback(err, record)
     */
    add: function(record, cb) {
      _ensureConnected(function(err, coll) {
        if (err) {
          cb(err);
          return;
        }
        coll.insert(record, function(err, records) {
          if (err) {
            cb(err);
            return;
          }
          cb(null, records[0]);
        });
      });
    },

    /**
     * Retrieves multiple records matching the provided query object.
     *
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, record)
     */
    find: function(query, cb) {
      _ensureConnected(function(err, coll) {
        if (err) {
          cb(err);
          return;
        }
        coll.find(query).toArray(cb);
      });
    },

    /**
     * Retrieves a single record matching the provided query object.
     *
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, record|null)
     */
    findOne: function(query, cb) {
      _ensureConnected(function(err, coll) {
        if (err) {
          cb(err);
          return;
        }
        coll.findOne(query, cb);
      });
    },

    /**
     * Drops current collection.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      _ensureConnected(function(err, coll) {
        if (err) {
          cb(err);
          return;
        }
        try {
          // drop() is a synchronous operation
          coll.drop();
          cb(null);
        } catch (err) {
          cb(err);
        }
      });
    }
  };
};
