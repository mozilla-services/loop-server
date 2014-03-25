/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Simple in-memory key/value store. This is provided as an example
 * implementation: it operates in O(n) time and is consequently not really
 * usable for anything other than small data sets.
 *
 * Available options:
 *
 * - {Array} unique: list of fields which compound value should be unique.
 *
 * @param  {Object} options          Options object
 * @return {MemoryStore}
 */
module.exports = function MemoryStore(settings, options) {
  "use strict";
  var _db = [],
      _options = options || {unique: []};

  /**
   * Checks if a record is a duplicate if unique constraints have been defined.
   * Sends back a boolean accordingly.
   *
   * @param  {Object}   record Record object
   * @param  {Function} cb     Callback(err, bool)
   */
  function _checkDuplicate(record, cb) {
    if (!Array.isArray(_options.unique) || _options.unique.length === 0) {
      cb(null, false);
      return;
    }
    var query = _options.unique.reduce(function(queryObj, field) {
      queryObj[field] = record[field];
      return queryObj;
    }, {});
    this.findOne(query, function(err, record) {
      if (err) {
        cb(err);
        return;
      }
      cb(null, !!record);
    });
  }

  return {
    /**
     * Returns store name; in the case of a memory store this doesn't make sense
     * so we always return null.
     *
     * @return {Null}
     */
    get name() {
      return null;
    },

    /**
     * Adds a record to the collection.
     *
     * @param {Object}   record Record Object
     * @param {Function} cb     Callback(err, record)
     */
    add: function(record, cb) {
      _db = _db || [];
      _checkDuplicate.call(this, record, function(err, exists) {
        if (err) {
          cb(err);
          return;
        }
        if (exists) {
          cb(new Error("Cannot add a duplicate entry"));
          return;
        }
        _db.push(record);
        cb(null, record);
      });
    },

    /**
     * Update all existing records matching the given criteria or create a
     * new one.
     *
     * @param {Object} criteria Criteria Object
     * @param {Object} newObj Record Object
     * @param {Function} cb Callback(err)
     */
    updateOrCreate: function(criteria, newObj, cb) {
      _db = _db || [];
      this.find(criteria, function(err, records) {
        if (err) {
          cb(err);
          return;
        }
        if (records.length === 0) {
          this.add(newObj, function(err) {
            cb(err);
          });
          return;
        }
        records.forEach(function(record) {
          for(var key in record) {
            delete record[key];
          }
          for(var key in newObj) {
            record[key] = newObj[key];
          }
        });
        cb(null);
      }.bind(this));
    },
    
    /**
     * Retrieves multiple records matching all the criterias defined by the
     * query object.
     *
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, records)
     */
    find: function(query, cb) {
      _db = _db || [];
      cb(null, _db.filter(function(record) {
        return Object.keys(query).every(function(field) {
          return record[field] === query[field];
        });
      }));
    },

    /**
     * Retrieves a single record matching all the criterias defined by the
     * query object. Sends undefined if no record was found.
     *
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, record|undefined)
     */
    findOne: function(query, cb) {
      this.find(query, function(err, records) {
        if (records.length === 0) {
          cb(null, null);
          return;
        }
        cb(null, records.shift());
      });
    },

    /**
     * Delete a single record matching all the criterias defined by the
     * query object.
     *
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, records)
     *
     * `records = null` if no record is found.
     *
     */
    delete: function(query, cb) {
      this.find(query, function(err, records) {
        if (records.length === 0) {
          cb(null, null);
          return;
        }

        var recordsCopy = JSON.parse(JSON.stringify(records));
        records.forEach(function(item) {
          var i = _db.indexOf(item);
          if (i != -1) {
            _db.splice(i, 1);
          }
        });

        cb(null, recordsCopy);
      });
    },

    /**
     * Drops current database.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      _db = [];
      cb(null);
    }
  };
};
